import { db, must } from "../db";
import { uploadObject } from "../storage";
import { errorCode, log } from "../log";
import { siteIcon } from "./site-icon";
import { openAddressRows } from "../vault";

// Company icons for the Companies list, from each company's own website (see site-icon.ts), saved in the
// private "avatars" bucket at <user id>/org-<organization id>. Each company is looked at again after a
// month, so a new logo shows up and a site that had none gets another chance.

const RECHECK_MS = 30 * 24 * 60 * 60_000;
const AT_ONCE = 4;
const BATCH = 200;

export async function syncCompanyIcons() {
  const stale = new Date(Date.now() - RECHECK_MS).toISOString();
  const orgs = must(
    await db
      .from("organizations")
      .select("id, user_id, domain")
      .or(`avatar_updated_at.is.null,avatar_updated_at.lt.${stale}`)
      .order("avatar_updated_at", { ascending: true, nullsFirst: true })
      .limit(BATCH),
    "load companies for icons",
  );
  await openAddressRows(orgs);
  if (orgs.length === 0) return;

  let saved = 0;
  let next = 0;
  // A few sites at a time: each is a different server, and one slow site should not hold up the rest.
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, orgs.length) }, async () => {
      while (next < orgs.length) {
        const org = orgs[next++];
        try {
          if (await saveIcon(org)) saved++;
        } catch (err) {
          log.warn("company icon failed", { organization: org.id, code: errorCode(err) });
        }
      }
    }),
  );
  log.info("company icons checked", { checked: orgs.length, saved });
}

async function saveIcon(org: { id: string; user_id: string; domain: string }): Promise<boolean> {
  const icon = await siteIcon(org.domain);
  const now = new Date().toISOString();
  if (!icon) {
    must(await db.from("organizations").update({ avatar_updated_at: now }).eq("id", org.id), "mark company icon checked");
    return false;
  }
  const path = `${org.user_id}/org-${org.id}`;
  await uploadObject("avatars", path, icon.bytes, icon.type);
  must(await db.from("organizations").update({ avatar_path: path, avatar_updated_at: now }).eq("id", org.id), "save company icon");
  return true;
}
