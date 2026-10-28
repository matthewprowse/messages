// The linked device's WhatsApp session, kept in whatsapp_auth_keys instead of files: the account's
// credentials plus the Signal keys Baileys creates as it talks to people. Every value is encrypted with
// the user's own key (vault.ts, credentialSealer) before it leaves the worker, and every change is written straight away, so a crash or
// restart never loses a key (a lost key means messages that can no longer be decrypted).

import { initAuthCreds, type AuthenticationCreds, type SignalDataSet, type SignalDataTypeMap, type SignalKeyStore } from "baileys";
import { SerialQueue } from "../backoff";
import { db, must } from "../db";
import { credentialSealer } from "../vault";
import { chunks, push } from "../util";
import { CREDS, decodeKey, encodeKey } from "./auth-codec";

const ID_BATCH = 100; // keeps each lookup's URL short

export interface DbAuthState {
  state: { creds: AuthenticationCreds; keys: SignalKeyStore };
  saveCreds(): Promise<void>;
  /** Removes the whole session, after WhatsApp unlinks the device. */
  wipe(): Promise<void>;
}

export async function useDbAuthState(accountId: string): Promise<DbAuthState> {
  // Writes run one after another, so an older value can never land after a newer one.
  const writes = new SerialQueue();
  const sealer = await credentialSealer(accountId);

  const credsRow = must(
    await db
      .from("whatsapp_auth_keys")
      .select("ciphertext")
      .eq("account_id", accountId)
      .eq("key_type", CREDS.type)
      .eq("key_id", CREDS.id)
      .maybeSingle(),
    "load whatsapp creds",
  );
  const creds = credsRow ? await decodeKey<AuthenticationCreds>(CREDS.type, credsRow.ciphertext, sealer) : initAuthCreds();

  const keys: SignalKeyStore = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const out: { [id: string]: SignalDataTypeMap[T] } = {};
      const batches = await Promise.all(
        chunks(ids, ID_BATCH).map(async (batch) =>
          must(
            await db.from("whatsapp_auth_keys").select("key_id, ciphertext").eq("account_id", accountId).eq("key_type", type).in("key_id", batch),
            "load whatsapp keys",
          ),
        ),
      );
      for (const row of batches.flat()) out[row.key_id] = await decodeKey<SignalDataTypeMap[T]>(type, row.ciphertext, sealer);
      return out;
    },

    async set(data: SignalDataSet) {
      const upserts: { account_id: string; key_type: string; key_id: string; ciphertext: string }[] = [];
      const deletes = new Map<string, string[]>();
      for (const [type, values] of Object.entries(data)) {
        for (const [id, value] of Object.entries(values ?? {})) {
          if (value) upserts.push({ account_id: accountId, key_type: type, key_id: id, ciphertext: await encodeKey(value, sealer) });
          else push(deletes, type, id);
        }
      }
      await writes.run(async () => {
        for (const batch of chunks(upserts, ID_BATCH)) {
          must(await db.from("whatsapp_auth_keys").upsert(batch, { onConflict: "account_id,key_type,key_id" }), "save whatsapp keys");
        }
        for (const [type, ids] of deletes) {
          for (const batch of chunks(ids, ID_BATCH)) {
            must(await db.from("whatsapp_auth_keys").delete().eq("account_id", accountId).eq("key_type", type).in("key_id", batch), "delete whatsapp keys");
          }
        }
      });
    },

    async clear() {
      await writes.run(async () => {
        must(await db.from("whatsapp_auth_keys").delete().eq("account_id", accountId).neq("key_type", CREDS.type), "clear whatsapp keys");
      });
    },
  };

  return {
    state: { creds, keys },
    saveCreds: () =>
      writes.run(async () => {
        must(
          await db.from("whatsapp_auth_keys").upsert(
            { account_id: accountId, key_type: CREDS.type, key_id: CREDS.id, ciphertext: await encodeKey(creds, sealer) },
            { onConflict: "account_id,key_type,key_id" },
          ),
          "save whatsapp creds",
        );
      }),
    wipe: () =>
      writes.run(async () => {
        must(await db.from("whatsapp_auth_keys").delete().eq("account_id", accountId), "wipe whatsapp session");
      }),
  };
}

/** A device counts as linked once WhatsApp has signed its identity. A pairing code request alone sets `me`, not this. */
export function isLinked(creds: AuthenticationCreds): boolean {
  return !!creds.account;
}
