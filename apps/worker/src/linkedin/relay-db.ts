import { db, must } from "../db";
import { credentialSealer } from "../vault";
import { parseRelay, type Relay } from "./relay";

// The relay (relay.ts) as it is kept: sealed in account_credentials.refreshed.

export async function readRelay(accountId: string): Promise<Relay> {
  const row = must(await db.from("account_credentials").select("refreshed").eq("account_id", accountId).maybeSingle(), "load linkedin sign-in");
  if (!row?.refreshed) return { step: null };
  try {
    return parseRelay(await (await credentialSealer(accountId)).openJson<unknown>(row.refreshed));
  } catch {
    return { step: null };
  }
}

/** Replaces the relay: a new step, with no reply to the last one. Null clears it. */
export async function writeRelay(accountId: string, relay: Relay | null) {
  const refreshed = relay ? await (await credentialSealer(accountId)).sealJson(relay) : null;
  must(
    await db.from("account_credentials").update({ refreshed }).eq("account_id", accountId),
    "save linkedin sign-in",
  );
}
