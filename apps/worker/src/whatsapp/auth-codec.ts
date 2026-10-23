import { BufferJSON, proto } from "baileys";
import { decrypt, encrypt } from "../crypto";

// How one piece of the WhatsApp session is stored: JSON with Buffers kept as base64 (Baileys' BufferJSON),
// then encrypted with AES-256-GCM. Kept apart from the database code so it can be unit tested.

/** The row that holds the account's own credentials. Everything else is a Signal key by type and ID. */
export const CREDS = { type: "creds", id: "creds" } as const;

export function encodeKey(value: unknown, rawKey: string): string {
  return encrypt(JSON.stringify(value, BufferJSON.replacer), rawKey);
}

export function decodeKey<T>(type: string, ciphertext: string, rawKey: string): T {
  const value = JSON.parse(decrypt(ciphertext, rawKey), BufferJSON.reviver);
  // Baileys expects this one as a protobuf object, not plain JSON.
  if (type === "app-state-sync-key" && value) return proto.Message.AppStateSyncKeyData.fromObject(value) as T;
  return value as T;
}
