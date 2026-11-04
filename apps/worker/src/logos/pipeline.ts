// The sync worker's part of the shared company logo queue (supabase/migrations/20261031100000_company_logos.sql):
// gathering and framing candidates, and saving the judge's pick. The AI worker (apps/ai/ai/logos.py) only
// asks Gemini: it judges the numbered sheet saved here, and searches when nothing passed. Review files stay in the
// private "logos" bucket; a pick is saved by public.ts.

import sharp from "sharp";
import type { Tables } from "@messages/db";
import { db, must } from "../db";
import { errorCode, log } from "../log";
import { storageError, uploadObject } from "../storage";
import { frameLogo, type Logo, type Rgb } from "../photos/logo-image";
import { LOGOS_BUCKET, logoKey } from "./paths";
import { downloadLogo, retireLogo, saveChosenLogo } from "./public";
import { judgeSheet } from "./sheet";
import { gather, searchResults, SOURCE_ORDER, type Found, type LogoSource } from "./sources";
/** A framed logo less sharp than this (see Logo.quality) is never offered: a 48px favicon's mark is about 28. */
const MIN_QUALITY = 28;
/** Sharper than this counts the same, so a huge file does not beat a better-placed one. */
const GOOD = 120;
/** At most this many candidates on one sheet, and of each source. */
const MAX_CANDIDATES = 10;
const PER_SOURCE: Record<LogoSource, number> = { app_store: 2, bimi: 1, site: 4, wikidata: 2, google: 1, search: 4, simple_icons: 1 };
/** Two framed logos whose 16px thumbnails differ by less than this on average are the same logo. */
const SAME_LOGO = 10;
const DARK_BG: Rgb = [10, 10, 10];

export type LogoRow = Tables<"company_logos">;

export interface Candidate {
  n: number;
  source: LogoSource;
  url: string;
  path: string;
  note?: string;
  fit: Logo["fit"];
  quality: number;
}

export interface Framed {
  found: Found;
  logo: Logo;
}

async function thumbnail(png: Buffer): Promise<Buffer> {
  return sharp(png).resize(16, 16, { fit: "fill" }).removeAlpha().raw().toBuffer();
}
const difference = (a: Buffer, b: Buffer) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

/** The colour most of the framed marks sit on, other than white and black: the brand's colour, most likely. */
function brandColour(framed: Framed[]): Rgb | null {
  const counts = new Map<string, { colour: Rgb; n: number }>();
  for (const { logo } of framed) {
    const c = logo.background;
    if (!c || Math.max(...c) - Math.min(...c) < 40) continue; // white, black and greys
    const key = c.map((v) => Math.round(v / 16)).join(",");
    counts.set(key, { colour: c, n: (counts.get(key)?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.colour ?? null;
}

/**
 * Frames every file found and keeps what is worth showing the judge: readable and sharp enough, not one the
 * owner turned down, not the same as one already kept, the best few of each source, numbered in SOURCE_ORDER.
 * A white mark that went on near-black goes on the brand's colour instead, when another candidate shows it.
 */
export async function frameAll(found: Found[], excluded: readonly string[] = []): Promise<Framed[]> {
  const seen = new Set(excluded);
  const files = found.filter((f) => !seen.has(f.url) && seen.add(f.url));
  let framed = (await Promise.all(files.map(async (f) => ({ found: f, logo: await frameLogo(f.bytes).catch(() => null) }))))
    .filter((f): f is Framed => !!f.logo && f.logo.quality >= MIN_QUALITY);
  const brand = brandColour(framed);
  if (brand) {
    framed = await Promise.all(
      framed.map(async (f) => {
        if (f.logo.fit !== "mark" || f.logo.background?.join() !== DARK_BG.join()) return f;
        const again = await frameLogo(f.found.bytes, { brand }).catch(() => null);
        return again ? { ...f, logo: again } : f;
      }),
    );
  }
  const order = (f: Framed) => SOURCE_ORDER.indexOf(f.found.source);
  framed.sort((a, b) => order(a) - order(b) || Math.min(b.logo.quality, GOOD) - Math.min(a.logo.quality, GOOD));

  const kept: (Framed & { thumb: Buffer })[] = [];
  const perSource = new Map<LogoSource, number>();
  for (const f of framed) {
    if (kept.length >= MAX_CANDIDATES) break;
    const count = perSource.get(f.found.source) ?? 0;
    if (count >= PER_SOURCE[f.found.source]) continue;
    const thumb = await thumbnail(f.logo.png);
    if (kept.some((k) => difference(k.thumb, thumb) < SAME_LOGO)) continue;
    kept.push({ ...f, thumb });
    perSource.set(f.found.source, count + 1);
  }
  return kept.map(({ found, logo }) => ({ found, logo }));
}

export async function clearReview(key: string) {
  const bucket = db.storage.from(LOGOS_BUCKET);
  // A company has about 22 pictures; a few rounds make sure none is left even if there are more.
  for (let round = 0; round < 5; round++) {
    const { data, error } = await bucket.list(`review/${key}`, { limit: 100 });
    if (error) throw storageError("list logo review", error);
    const paths = (data ?? []).map((o) => `review/${key}/${o.name}`);
    if (paths.length === 0) return;
    const removed = await bucket.remove(paths);
    if (removed.error) throw storageError("remove logo review", removed.error);
  }
}

async function update(domain: string, patch: Partial<LogoRow>) {
  must(await db.from("company_logos").update({ ...patch, updated_at: new Date().toISOString() }).eq("domain", domain), "update company logo");
}

/**
 * A queued company: its candidates gathered (round 1: the free sources; round 2: what Gemini found with
 * Google Search, followed by round 1's candidates again, so the last look can still settle for the best of
 * those), framed and saved with the judge's sheet, then on to judging. With nothing to judge, round 1 moves
 * on to searching and round 2 ends on the first letter.
 */
export async function gatherCandidates(row: LogoRow): Promise<Candidate[]> {
  const key = logoKey(row.domain);
  const found = row.round === 1 ? await gather(row.name, row.domain) : await searchResults(row.search_urls);
  const framed = await frameAll(found, row.excluded);
  if (row.round === 1) await clearReview(key);

  const candidates: Candidate[] = [];
  const pictures: Buffer[] = [];
  for (const f of framed) {
    const n = candidates.length + 1;
    const path = `review/${key}/${row.round}-${n}.png`;
    await uploadObject(LOGOS_BUCKET, path, f.logo.png, "image/png");
    candidates.push({ n, source: f.found.source, url: f.found.url, path, note: f.found.note, fit: f.logo.fit, quality: f.logo.quality });
    pictures.push(f.logo.png);
  }
  const searched = candidates.length;
  if (row.round === 2) {
    for (const earlier of (row.candidates as unknown as Candidate[]) ?? []) {
      if (row.excluded.includes(earlier.url) || candidates.some((c) => c.url === earlier.url)) continue;
      const picture = await downloadLogo(earlier.path).catch(() => null);
      if (!picture) continue;
      candidates.push({ ...earlier, n: candidates.length + 1, note: `Earlier candidate, before searching: ${earlier.note ?? earlier.source}` });
      pictures.push(picture);
    }
  }
  const reset = row.round === 1 ? { gemini_calls: 0, gemini_cost_usd: 0, rejected: [] } : {};
  if (searched === 0 && (row.round === 1 || candidates.length === 0)) {
    if (row.round === 1) await update(row.domain, { ...reset, candidates: [], sheet_path: null, pick: null, status: "searching" });
    else await finish(row, null, "Nothing found, even with Google Search.");
    return candidates;
  }
  const sheetPath = `review/${key}/${row.round}-sheet.png`;
  await uploadObject(LOGOS_BUCKET, sheetPath, await judgeSheet(pictures), "image/png");
  await update(row.domain, { ...reset, candidates: candidates as unknown as LogoRow["candidates"], sheet_path: sheetPath, pick: null, status: "judging" });
  return candidates;
}

/** A judged company: the pick saved as its logo, or on to searching after round 1, or the first letter after round 2. */
export async function saveJudged(row: LogoRow): Promise<void> {
  const candidates = (row.candidates as unknown as Candidate[]) ?? [];
  const chosen = row.pick ? candidates.find((c) => c.n === row.pick) : undefined;
  if (chosen) return finish(row, chosen);
  if (row.round === 1 && !row.manual) return update(row.domain, { status: "searching", pick: null });
  return finish(row, null);
}

async function finish(row: LogoRow, chosen: Candidate | null, verdict?: string) {
  const now = new Date().toISOString();
  if (!chosen) {
    await update(row.domain, { status: "done", path: null, source: null, url: null, checked_at: now, ...(row.path ? { changed_at: now } : {}), ...(verdict ? { verdict } : {}) });
    return;
  }
  const path = await saveChosenLogo(row.domain, await downloadLogo(chosen.path), row.path);
  const changed = row.url !== chosen.url || row.path !== path;
  await update(row.domain, { status: "done", path, source: chosen.source, url: chosen.url, checked_at: now, ...(changed ? { changed_at: now } : {}) });
  // A new name (a new picture, or the first save in the public bucket): companies move to it now, not at the daily link.
  if (row.path && row.path !== path) await retireLogo(row.path, path).catch((err) => log.warn("old company logo not retired", { code: errorCode(err) }));
}
