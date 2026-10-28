import { allRows, db, must } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { startEvery } from "../backoff";
import { mapLimit } from "../util";
import { openAddressRows } from "../vault";
import { gatherCandidates, saveJudged, type LogoRow } from "./pipeline";

// The shared company logo queue, on the sync worker's side (see pipeline.ts): every company domain anyone
// hears from is queued once, the queue is worked every half minute, and each logo is looked at again after
// a few months for rebrands (one the owner chose by hand is left alone). Off until COMPANY_LOGOS is "true".

const FIRST_RUN_MS = 60_000;
const POLL_MS = 30_000;
const ENQUEUE_EVERY_MS = 6 * 60 * 60_000;
const RECHECK_MS = 90 * 24 * 60 * 60_000;
const BATCH = 20;
/** Companies gathered at once: each is several different servers, and one slow site should not hold up the rest. */
const AT_ONCE = 4;

let started = false;
let lastEnqueued = 0;

export function startCompanyLogos() {
  if (started || !env.companyLogos) return;
  started = true;
  startEvery(FIRST_RUN_MS, POLL_MS, runCompanyLogos, (err) => log.warn("company logos failed", { code: errorCode(err) }));
}

async function runCompanyLogos() {
  let link = false;
  if (Date.now() - lastEnqueued > ENQUEUE_EVERY_MS) {
    lastEnqueued = Date.now();
    const added = await queueCompanies();
    const rechecks = await queueRechecks();
    if (added + rechecks > 0) log.info("company logos queued", { added, rechecks });
    link = true; // new companies since, whose logos are already known
  }
  // A judged company may have a new logo now.
  if ((await workLogoQueue()) > 0) link = true;
  if (link) {
    const linked = await linkOrganizationLogos();
    if (linked > 0) log.info("company logos linked", { companies: linked });
  }
}

/**
 * Points every company at its domain's logo (organizations.logo_path), or at none while it has none, so the
 * app can show it: domains are sealed per user, so only here can they be matched. Returns how many changed.
 */
export async function linkOrganizationLogos(): Promise<number> {
  const logos = new Map(
    must(await db.from("company_logos").select("domain, path").eq("status", "done"), "load finished logos").map((r) => [r.domain, r.path]),
  );
  const orgs = await openAddressRows(await allRows((from, to) => db.from("organizations").select("id, user_id, domain, logo_path").order("id").range(from, to), "load companies"));
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
  const orgs = await openAddressRows(await allRows((from, to) => db.from("organizations").select("id, user_id, name, domain").order("id").range(from, to), "load companies"));
  const known = new Set(must(await db.from("company_logos").select("domain"), "load company logos").map((r) => r.domain));
  const rows = new Map<string, { domain: string; name: string }>();
  for (const org of orgs) {
    const domain = org.domain?.toLowerCase();
    if (!domain || known.has(domain) || rows.has(domain) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) continue;
    rows.set(domain, { domain, name: org.name });
  }
  return queueDomains([...rows.values()]);
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
