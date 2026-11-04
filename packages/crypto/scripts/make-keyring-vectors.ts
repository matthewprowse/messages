// Prints the vectors that pin a rotated user's keys: a value sealed under the previous data key opens with the keyring
// (deriveUserKeyring), the raw index key kept at rotation (deriveIndexKey) makes the same blind index tokens the old key
// made, and the index key wraps under "user_index_keys:<user id>". The TS tests (src/index.test.ts, src/wrap.test.ts) and
// the Python tests (apps/ai/tests/test_crypto.py) both check against the saved file.
// Run: pnpm --filter @messages/crypto exec tsx scripts/make-keyring-vectors.ts > keyring-vectors.json
import { blindIndex, deriveIndexKey, deriveUserKeys, encryptField } from "../src/index";
import { addressKey } from "../src/addresses";
import { readFileSync } from "node:fs";

// The index key wrapped by the local wrapper as a rotation stores it, with a fixed IV so the file is stable.
const { localWrap } = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url), "utf8"));
async function wrapIndexKey(raw: Uint8Array<ArrayBuffer>, userId: string): Promise<string> {
  const master = await crypto.subtle.importKey("raw", Buffer.from(localWrap.masterKeyBase64, "base64"), "AES-GCM", false, ["encrypt"]);
  const iv = Uint8Array.from({ length: 12 }, (_, i) => 90 + i);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`user_index_keys:${userId}`) }, master, raw));
  return Buffer.concat([iv, sealed]).toString("base64");
}

const previous = Uint8Array.from({ length: 32 }, (_, i) => i);
const current = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const oldKeys = await deriveUserKeys(previous);
const indexKey = await deriveIndexKey(previous);
const nonce = Uint8Array.from({ length: 12 }, (_, i) => 30 + i);
const newNonce = Uint8Array.from({ length: 12 }, (_, i) => 60 + i);
console.log(JSON.stringify({
  previousKeyHex: Buffer.from(previous).toString("hex"),
  currentKeyHex: Buffer.from(current).toString("hex"),
  indexKeyHex: Buffer.from(indexKey).toString("hex"),
  field: "body",
  plaintext: "Moved to the new key, read with the old one meanwhile.",
  sealedUnderPrevious: await encryptField(oldKeys, "body", "Moved to the new key, read with the old one meanwhile.", nonce),
  sealedUnderCurrent: await encryptField(await deriveUserKeys(current), "body", "Moved to the new key, read with the old one meanwhile.", newNonce),
  address: "sam@example.com",
  addressToken: await blindIndex(oldKeys, addressKey("sam@example.com")),
  indexWrap: { masterKeyBase64: localWrap.masterKeyBase64, userId: localWrap.userId, wrapped: await wrapIndexKey(indexKey, localWrap.userId) },
}, null, 2));
