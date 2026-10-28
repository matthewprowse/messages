// The shared company logo queue, on the sync worker's side (see pipeline.ts): every company domain anyone
// hears from is queued once, the queue is worked every half minute, and each logo is looked at again after
// a few months for rebrands (one the owner chose by hand is left alone). Off until COMPANY_LOGOS is "true".
//
// COST: organizations are sealed per user, so matching them to logos means opening each domain with its user's
// key. The job therefore avoids scanning them all:
//   * every 15 minutes it looks only at organizations created after the last one it saw (one query when none);
//   * after the queue finished or queued something, companies still without a logo (logo_path null) are linked,
//     at most every 10 minutes (it was every 30 seconds during a backfill);
//   * once a day everything is read and linked as before, the safety net (it was every 6 hours);
//   * once an hour a bounded batch of finished rows has its review pictures deleted, 3 days after it finished
//     (company_logos.review_cleared_at, see the migration notes; skipped until that column exists).

import { allRows, db, must } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { startEvery } from "../backoff";
import { mapLimit } from "../util";
import { openAddressRows } from "../vault";
import { clearReview, gatherCandidates, logoKey, saveJudged, type LogoRow } from "./pipeline";

const FIRST_RUN_MS = 60_000;
const POLL_MS = 30_000;
/** Look for organizations created since the last look. */
export const NEW_ORGS_EVERY_MS = 15 * 60_000;
/** Read every organization, queue and link: the safety net. */
export const FULL_EVERY_MS = 24 * 60 * 60_000;
/** The least time between two links of the companies still without a logo. */
export const LINK_EVERY_MS = 10 * 60_000;
export const CLEAN_EVERY_MS = 60 * 60_000;
/** A finished row keeps its review pictures this long. */
export const REVIEW_KEEP_MS = 3 * 24 * 60 * 60_000;
const CLEAN_BATCH = 25;
const RECHECK_MS = 90 * 24 * 60 * 60_000;
const BATCH = 20;
/** Companies gathered at once: each is several different servers, and one slow site should not hold up the rest. */
const AT_ONCE = 4;

let started = false;

export interface LogoState {
  lastFull: number;
  lastNewCheck: number;
  lastLink: number;
  lastClean: number;
  /** Newest organization created_at seen, or null before the first full read. */
  watermark: string | null;
  /** Something finished or was queued since the last link, so companies may have a logo to point at. */
  linkDirty: boolean;
}

export const newLogoState = (): LogoState => ({ lastFull: 0, lastNewCheck: 0, lastLink: 0, lastClean: 0, watermark: null, linkDirty: false });

/** What the enqueue step does now: everything, only organizations newer than the watermark, or nothing. */
export function enqueueMode(s: LogoState, now: number): "full" | "new" | null {
  if (s.watermark === null || now - s.lastFull >= FULL_EVERY_MS) return "full";
  return now - s.lastNewCheck >= NEW_ORGS_EVERY_MS ? "new" : null;
}

/** What the link step does now, after the queue was worked: everything (with a full read), the companies without a logo, or nothing. */
export function linkMode(s: LogoState, now: number, enqueued: "full" | "new" | null): "full" | "without" | null {
  if (enqueued === "full") return "full";
  return s.linkDirty && now - s.lastLink >= LINK_EVERY_MS ? "without" : null;
}

const state = newLogoState();

export function startCompanyLogos() {
  if (started || !env.companyLogos) return;
  started = true;
  startEvery(FIRST_RUN_MS, POLL_MS, runCompanyLogos, (err) => log.warn("company logos failed", { code: errorCode(err) }));
}

async function runCompanyLogos() {
  const now = Date.now();
  const mode = enqueueMode(state, now);
  if (mode) {
    if (mode === "full") state.lastFull = now;
    state.lastNewCheck = now;
    const { added, watermark } = await queueCompaniesSince(mode === "full" ? null : state.watermark);
    if (watermark) state.watermark = watermark;
    else if (mode === "full") state.watermark = state.watermark ?? new Date(0).toISOString();
    const rechecks = mode === "full" || added > 0 ? await queueRechecks() : 0;
    if (added + rechecks > 0) log.info("company logos queued", { added, rechecks });
    if (added + rechecks > 0) state.linkDirty = true;
  }
  // A judged company may have a new logo now.
  if ((await workLogoQueue()) > 0) state.linkDirty = true;
  const link = linkMode(state, now, mode);
  if (link) {
    state.lastLink = now;
    state.linkDirty = false;
    const linked = await linkOrganizationLogos(link === "without");
    if (linked > 0) log.info("company logos linked", { companies: linked });
  }
  if (now - state.lastClean >= CLEAN_EVERY_MS) {
    state.lastClean = now;
    const cleared = await clearFinishedReviews(now).catch((err) => {
      log.warn("logo review cleanup failed", { code: errorCode(err) });
      return 0;
    });
    if (cleared > 0) log.info("logo reviews cleared", { companies: cleared });
  }
}

/**
 * Points every company at its domain's logo (organizations.logo_path), or at none while it has none, so the
 * app can show it: domains are sealed per user, so only here can they be matched. Returns how many changed.
 * onlyWithout reads just the companies with no logo yet: a company that has one keeps it (the path depends on the
 * domain alone), and the daily full pass fixes the rest.
 */
export async function linkOrganizationLogos(onlyWithout = false): Promise<number> {
  const logos = new Map(
    must(await db.from("company_logos").select("domain, path").eq("status", "done"), "load finished logos").map((r) => [r.domain, r.path]),
  );
  const orgs = await openAddressRows(
    await allRows((from, to) => {
      const q = db.from("organizations").select("id, user_id, domain, logo_path");
      return (onlyWithout ? q.is("logo_path", null) : q).order("id").range(from, to);
    }, "load companies"),
  );
  const changed = orgs.filter((o) => {
    const domain = o.domain?.toLowerCase();
    return domain && logos.has(domain) && (logos.get(domain) ?? null) !== o.logo_path;
  });
  await mapLimit(changed, AT_ONCE, async (o) => {
    must(await db.from("organizations").update({ logo_path: logos.get(o.domain.toLowerCase()) ?? null }).eq("id", o.id), "link company logo");
  });
  return changed.length;
}

/** Queues every company domain in Konva that has no row yet, named as its first company is. Returns how many were added. */
export async function queueCompanies(): Promise<number> {
  return (await queueCompaniesSince(null)).added;
}

/**
 * Like queueCompanies, for the organizations created after `since` (null: all of them). Also returns the newest
 * created_at read, the next call's `since`. With nothing new it is one query.
 */
export async function queueCompaniesSince(since: string | null): Promise<{ added: number; watermark: string | null }> {
  const raw = await allRows((from, to) => {
    const q = db.from("organizations").select("id, user_id, name, domain, created_at");
    return (since ? q.gt("created_at", since) : q).order("id").range(from, to);
  }, "load companies");
  const watermark = raw.reduce<string | null>((max, o) => (max === null || o.created_at > max ? o.created_at : max), null);
  if (raw.length === 0) return { added: 0, watermark };
  const orgs = await openAddressRows(raw);
  const known = new Set(must(await db.from("company_logos").select("domain"), "load company logos").map((r) => r.domain));
  const rows = new Map<string, { domain: string; name: string }>();
  for (const org of orgs) {
    const domain = org.domain?.toLowerCase();
    if (!domain || known.has(domain) || rows.has(domain) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) continue;
    rows.set(domain, { domain, name: org.name });
  }
  return { added: await queueDomains([...rows.values()]), watermark };
}

/** Queues these companies, leaving ones already queued or done alone. Returns how many were added. */
export async function queueDomains(rows: { domain: string; name: string }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const added = must(await db.from("company_logos").upsert(rows, { onConflict: "domain", ignoreDuplicates: true }).select("domain"), "queue company logos");
  return added.length;
}

/** Sends logos last looked at more than RECHECK_MS ago back to the start. Returns how many. */
export async function queueRechecks(): Promise<number> {
  const stale = new Date(Date.now() - RECHECK_MS).toISOString();
  const rows = must(
    await db
      .from("company_logos")
      .update({ status: "queued", round: 1, pick: null, search_urls: [], updated_at: new Date().toISOString() })
      .eq("status", "done")
      .eq("manual", false)
      .lt("checked_at", stale)
      // A company given up on after its tries waits out ai_retry_after (30 days) before it is looked at again.
      .or(`ai_retry_after.is.null,ai_retry_after.lt.${new Date().toISOString()}`)
      .select("domain"),
    "queue logo rechecks",
  );
  // The new round makes new review pictures, which are cleared again after it finishes (clearFinishedReviews).
  // Best effort: the column comes with its migration.
  if (rows.length) await (db.from("company_logos") as unknown as { update(v: unknown): any }).update({ review_cleared_at: null }).in("domain", rows.map((r) => r.domain));
  return rows.length;
}

/** Works one batch of the sync worker's steps: gathering for queued companies, saving for judged ones. Returns how many. */
export async function workLogoQueue(): Promise<number> {
  const rows: LogoRow[] = must(
    await db.from("company_logos").select("*").in("status", ["queued", "judged"]).order("updated_at", { ascending: true }).limit(BATCH),
    "load logo queue",
  );
  await mapLimit(rows, AT_ONCE, async (row) => {
    try {
      if (row.status === "queued") await gatherCandidates(row);
      else await saveJudged(row);
    } catch (err) {
      log.warn("company logo step failed", { step: row.status, code: errorCode(err) });
      // Tried again after the others.
      await db.from("company_logos").update({ updated_at: new Date().toISOString() }).eq("domain", row.domain);
    }
  });
  return rows.length;
}

/**
 * Deletes the review pictures (about 22 per company) of finished companies, REVIEW_KEEP_MS after they finished, a
 * bounded batch per call. A row is marked with review_cleared_at so it is never listed again. Returns how many
 * companies were cleared; 0 (quietly) while the column does not exist yet.
 */
export async function clearFinishedReviews(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - REVIEW_KEEP_MS).toISOString();
  // review_cleared_at comes with its migration and is not in the generated types yet, so this reads it by name.
  const table = db.from("company_logos") as unknown as { select(s: string): any; update(v: unknown): any };
  const { data, error } = await table.select("domain").eq("status", "done").is("review_cleared_at", null).lt("updated_at", cutoff).order("updated_at").limit(CLEAN_BATCH);
  if (error) {
    if (error.code === "42703") return 0; // the column has not been added yet
    throw Object.assign(new Error("load finished logos to clear failed"), { code: error.code });
  }
  const domains = (data as { domain: string }[]).map((r) => r.domain);
  const cleared: string[] = [];
  await mapLimit(domains, AT_ONCE, async (domain) => {
    try {
      await clearReview(logoKey(domain));
      cleared.push(domain);
    } catch (err) {
      log.warn("logo review not cleared", { code: errorCode(err) });
    }
  });
  if (cleared.length) must(await table.update({ review_cleared_at: new Date(now).toISOString() }).in("domain", cleared), "mark logo reviews cleared");
  return cleared.length;
}
