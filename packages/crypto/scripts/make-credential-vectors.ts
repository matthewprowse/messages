// Prints the vectors that pin how connector credentials ("account:<id>") and handoffs stored in a row
// ("handoff:<table>.<column>:<row id>") are sealed under a user's key ("v2:"): the TS tests (src/wrap.test.ts) and the
// Python tests (apps/ai/tests/test_keys_kms.py) both check against the saved file.
// Run: pnpm --filter @messages/crypto exec tsx scripts/make-credential-vectors.ts > credential-vectors.json
import { deriveCredentialKey, handoffContext, sealBound, sealCredential } from "../src/wrap";

const dataKey = Uint8Array.from({ length: 32 }, (_, i) => i);
const key = await deriveCredentialKey(dataKey);
const accountId = "caabe3e9-0000-4000-8000-0000000000c1";
const plaintext = JSON.stringify({ username: "sam@example.com", password: "abcd-efgh-ijkl-mnop" });
const iv = Uint8Array.from({ length: 12 }, (_, i) => 50 + i);
const handoffIv = Uint8Array.from({ length: 12 }, (_, i) => 80 + i);
const context = handoffContext("icloud_setups", "sign_in", "5e7a0c1d-0000-4000-8000-0000000000d2");
const handoffText = JSON.stringify({ appleId: "sam@icloud.com", password: "correct horse", mailUser: "sam@icloud.com", address: "" });
console.log(JSON.stringify({
  dataKeyHex: Buffer.from(dataKey).toString("hex"),
  credentialKeyHex: Buffer.from(key).toString("hex"),
  accountId,
  plaintext,
  ivHex: Buffer.from(iv).toString("hex"),
  sealed: await sealCredential(key, accountId, plaintext, iv),
  handoff: {
    context,
    plaintext: handoffText,
    ivHex: Buffer.from(handoffIv).toString("hex"),
    sealed: await sealBound(key, context, handoffText, handoffIv),
  },
}, null, 2));
