import { BufferJSON, proto } from "baileys";
import type { CredentialSealer } from "../crypto";

// How one piece of the WhatsApp session is stored: JSON with Buffers kept as base64 (Baileys' BufferJSON),
// then sealed under the user's key ("v2:", crypto.ts; "v1:" is still read). Kept apart from the database code so it can be unit tested.

/** The row that holds the account's own credentials. Everything else is a Signal key by type and ID. */
export const CREDS = { type: "creds", id: "creds" } as const;

export function encodeKey(value: unknown, sealer: Pick<CredentialSealer, "seal">): Promise<string> {
  return sealer.seal(JSON.stringify(value, BufferJSON.replacer));
}

export async function decodeKey<T>(type: string, ciphertext: string, sealer: Pick<CredentialSealer, "open">): Promise<T> {
  const value = JSON.parse(await sealer.open(ciphertext), BufferJSON.reviver);
  // Baileys expects this one as a protobuf object, not plain JSON.
  if (type === "app-state-sync-key" && value) return proto.Message.AppStateSyncKeyData.fromObject(value) as T;
  return value as T;
}
