// One-off (docs/PLAN.md, Security and Cost Review, item 6): moves every connector sign-in and session from the old
// static ENCRYPTION_KEY ("v1:") to the owner's own key ("v2:", derived from their data key, the account as additional
// data; src/crypto.ts). Covers account_credentials (ciphertext and refreshed) and the WhatsApp session in
// whatsapp_auth_keys. Short-lived handoffs (sign-in codes, iCloud setups, the OAuth cookies) are sealed under the user's own
// key since the per-user handoff release; a "v1:" one from before lives minutes and is not moved here. keys:readiness counts all.
//
//   pnpm credentials:reseal             Dry run, the default. Opens every v1 value, seals it v2, opens that again and
//                                       checks it is the same text, and writes nothing.
//   pnpm credentials:reseal --apply     Writes the v2 values.
//
// Needs ENCRYPTION_KEY (to read v1) and the key settings (KMS_KEY_NAME and/or KEY_WRAPPING_KEY). A value is written
// only if the row still holds the v1 text that was read, so it can be stopped, run again, and run beside the workers.
// Be aware: writing account_credentials.ciphertext moves updated_at (a trigger), which restarts that account's
// connector once within seconds, as a new sign-in does. Run it at a quiet time. Resealing `refreshed` and the
// WhatsApp rows does not restart anything. Once a dry run reports 0 left and `pnpm keys:readiness` agrees, ENCRYPTION_KEY
// can be removed from the worker, the AI worker and the web app.

import { allRows, db, must } from "../src/db";
import { credentialSealer } from "../src/vault";

const apply = process.argv.includes("--apply");
if (process.argv.some((a) => a.startsWith("--") && a !== "--apply" && a !== "--dry-run")) {
  console.error("Usage: pnpm credentials:reseal [--dry-run | --apply]");
  process.exit(1);
}

let moved = 0;
let skipped = 0;
let failed = 0;

async function reseal(accountId: string, value: string | null | undefined, write: (sealed: string) => Promise<number>) {
  if (!value || !value.startsWith("v1:")) { skipped++; return; }
  try {
    const sealer = await credentialSealer(accountId);
    const plain = await sealer.open(value);
    const sealed = await sealer.seal(plain);
    if ((await sealer.open(sealed)) !== plain) throw new Error("round trip differs");
    if (apply && (await write(sealed)) === 0) { console.log(`account ${accountId}: changed meanwhile, left for the next run`); return; }
    moved++;
  } catch (err) {
    failed++;
    console.error(`account ${accountId}: not moved (${(err as { code?: string }).code ?? (err as Error).message})`);
  }
}

const creds = await allRows((from, to) => db.from("account_credentials").select("account_id, ciphertext, refreshed").order("account_id").range(from, to), "load credentials");
for (const row of creds) {
  await reseal(row.account_id, row.ciphertext, async (sealed) =>
    must(await db.from("account_credentials").update({ ciphertext: sealed }).eq("account_id", row.account_id).eq("ciphertext", row.ciphertext).select("account_id"), "reseal credentials").length);
  await reseal(row.account_id, row.refreshed, async (sealed) =>
    must(await db.from("account_credentials").update({ refreshed: sealed }).eq("account_id", row.account_id).eq("refreshed", row.refreshed!).select("account_id"), "reseal refreshed").length);
}

// The guard repeats the old value as a filter, which travels in the URL. Some app state keys run to tens of kilobytes, too
// long for a URL, so for those the row is read again just before the write and compared here instead.
const URL_SAFE_FILTER = 4000;
const wa = await allRows((from, to) => db.from("whatsapp_auth_keys").select("account_id, key_type, key_id, ciphertext").order("account_id").order("key_type").order("key_id").range(from, to), "load whatsapp session");
for (const row of wa) {
  await reseal(row.account_id, row.ciphertext, async (sealed) => {
    const key = db.from("whatsapp_auth_keys").update({ ciphertext: sealed }).eq("account_id", row.account_id).eq("key_type", row.key_type).eq("key_id", row.key_id);
    if (row.ciphertext.length <= URL_SAFE_FILTER) return must(await key.eq("ciphertext", row.ciphertext).select("account_id"), "reseal whatsapp key").length;
    const now = must(await db.from("whatsapp_auth_keys").select("ciphertext").eq("account_id", row.account_id).eq("key_type", row.key_type).eq("key_id", row.key_id), "reread whatsapp key");
    if (now[0]?.ciphertext !== row.ciphertext) return 0;
    return must(await key.select("account_id"), "reseal whatsapp key").length;
  });
}

console.log(`${apply ? "Resealed" : "Would reseal"} ${moved} values (${creds.length} account sign-ins, ${wa.length} WhatsApp keys), ${skipped} already v2 or empty, ${failed} failed.${apply ? "" : " Nothing was written. Run again with --apply."}`);
process.exit(failed ? 1 : 0);
