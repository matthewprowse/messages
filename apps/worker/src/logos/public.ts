// Chosen company logos in the public "company-logos" bucket (supabase/migrations/20261124100000_public_company_logos.sql):
// saving a pick under its content-addressed name, pointing companies at it when it changes, and moving the logos saved
// before that out of the private "logos" bucket. Until the bucket exists everything stays as it was (private, <key>.png),
// so this worker runs the same before and after the migration.

import { sleep } from "../backoff";
import { db, must } from "../db";
import { errorCode, log } from "../log";
import { IMMUTABLE_CACHE_S, storageError, storageStatus, uploadObject } from "../storage";
import { isPublicLogoPath, LOGOS_BUCKET, privateLogoPath, PUBLIC_LOGOS_BUCKET, publicLogoPath } from "./paths";

/** How long a missing public bucket is believed before asking again. */
const BUCKET_RECHECK_MS = 10 * 60_000;
let bucketReady = false;
let bucketCheckedAt = 0;

/** Whether the public bucket exists. Once it does that is kept; until then it is asked again every BUCKET_RECHECK_MS. */
export async function publicLogosReady(now = Date.now()): Promise<boolean> {
  if (bucketReady || now - bucketCheckedAt < BUCKET_RECHECK_MS) return bucketReady;
  bucketCheckedAt = now;
  const { data, error } = await db.storage.getBucket(PUBLIC_LOGOS_BUCKET);
  bucketReady = !error && !!data?.public;
  return bucketReady;
}

/** A logo file's bytes from either bucket. Storage turns away bursts of requests (429), so a few tries are made. */
export async function downloadLogo(path: string): Promise<Buffer> {
  const bucket = isPublicLogoPath(path) ? PUBLIC_LOGOS_BUCKET : LOGOS_BUCKET;
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await db.storage.from(bucket).download(path);
    if (data) return Buffer.from(await data.arrayBuffer());
    const status = storageStatus(error);
    if (attempt >= 3 || status === 400 || status === 404) throw storageError("download logo", error);
    await sleep(1000 * 2 ** attempt);
  }
}

/**
 * Saves a company's chosen logo and returns its path: in the public bucket under its content-addressed name (nothing
 * is written when `current` is that name already), or in the private bucket at <key>.png until the public one exists.
 */
export async function saveChosenLogo(domain: string, png: Buffer, current: string | null): Promise<string> {
  if (!(await publicLogosReady())) {
    const path = privateLogoPath(domain);
    await uploadObject(LOGOS_BUCKET, path, png, "image/png");
    return path;
  }
  const path = publicLogoPath(domain, png);
  if (path !== current) await uploadObject(PUBLIC_LOGOS_BUCKET, path, png, "image/png", IMMUTABLE_CACHE_S);
  return path;
}

/**
 * After a company's logo moved from `old` to `next`: every company pointing at the old file points at the new one at
 * once (logo_path is not sealed, so no domain needs opening), then the old file is deleted. An app still showing the
 * old path falls back to the building icon until it reloads. A file that fails to delete only costs a few KB.
 */
export async function retireLogo(old: string, next: string): Promise<void> {
  must(await db.from("organizations").update({ logo_path: next }).eq("logo_path", old), "relink company logo");
  const { error } = await db.storage.from(isPublicLogoPath(old) ? PUBLIC_LOGOS_BUCKET : LOGOS_BUCKET).remove([old]);
  if (error) log.warn("old company logo not deleted", { code: errorCode(storageError("remove logo", error)) });
}

/**
 * Moves up to `limit` finished logos saved before the public bucket into it: copied under the new name, the row moved
 * (only while it is still done with that path, so a new pick saved meanwhile wins), its companies relinked and the old
 * file deleted. A logo whose file is gone is looked for again. Returns how many were moved or looked for again; 0 when
 * none are left, the bucket does not exist yet, or every one failed (tried again on a later pass).
 */
export async function movePublicLogos(limit: number): Promise<number> {
  if (!(await publicLogosReady())) return 0;
  // Private names have no "-": <64 hex>.png.
  const rows = must(
    await db.from("company_logos").select("domain, path").eq("status", "done").not("path", "is", null).not("path", "like", "%-%").order("domain").limit(limit),
    "load logos to move",
  );
  let done = 0;
  for (const row of rows) {
    const old = row.path!;
    try {
      const png = await downloadLogo(old).catch((err: unknown) => {
        if ((err as { code?: string }).code === "STORAGE_400" || (err as { code?: string }).code === "STORAGE_404") return null;
        throw err;
      });
      if (!png) {
        must(await db.from("company_logos").update({ status: "queued", round: 1, pick: null, search_urls: [], updated_at: new Date().toISOString() }).eq("domain", row.domain).eq("status", "done").eq("path", old), "requeue lost logo");
        done++;
        continue;
      }
      const path = publicLogoPath(row.domain, png);
      await uploadObject(PUBLIC_LOGOS_BUCKET, path, png, "image/png", IMMUTABLE_CACHE_S);
      const updated = must(await db.from("company_logos").update({ path }).eq("domain", row.domain).eq("status", "done").eq("path", old).select("domain"), "move company logo");
      if (updated.length === 0) continue;
      await retireLogo(old, path);
      done++;
    } catch (err) {
      log.warn("company logo not moved", { code: errorCode(err) });
    }
  }
  return done;
}
