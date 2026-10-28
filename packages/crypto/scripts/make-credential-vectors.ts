// Prints the vector that pins how connector credentials are sealed under a user's key ("v2:"): the TS tests
// (src/wrap.test.ts) and the Python tests (apps/ai/tests/test_crypto.py) both check against the saved file.
// Run: pnpm --filter @messages/crypto exec tsx scripts/make-credential-vectors.ts > credential-vectors.json
import { deriveCredentialKey, sealCredential } from "../src/wrap";

const dataKey = Uint8Array.from({ length: 32 }, (_, i) => i);
const key = await deriveCredentialKey(dataKey);
const accountId = "caabe3e9-0000-4000-8000-0000000000c1";
const plaintext = JSON.stringify({ username: "sam@example.com", password: "abcd-efgh-ijkl-mnop" });
const iv = Uint8Array.from({ length: 12 }, (_, i) => 50 + i);
console.log(JSON.stringify({
  dataKeyHex: Buffer.from(dataKey).toString("hex"),
  credentialKeyHex: Buffer.from(key).toString("hex"),
  accountId,
  plaintext,
  ivHex: Buffer.from(iv).toString("hex"),
  sealed: await sealCredential(key, accountId, plaintext, iv),
}, null, 2));
