// Prints the vectors that pin the bound value format (src/bound.ts): fields sealed as "e2:" for a user and "t2:" for a
// workspace, each bound to its owner, field, place and row, and files sealed as "e2b:" for the place they are stored.
// The TS tests (src/bound.test.ts) and the Python tests (apps/ai/tests/test_crypto_bound.py) both check against the file.
// Run: pnpm --filter @messages/crypto exec tsx scripts/make-bound-vectors.ts > bound-vectors.json
import { deriveTeamKeys, deriveUserKeys, encryptAt, encryptBytesAt, encryptTeamAt, encryptTeamBytesAt } from "../src/index";

const dataKey = Uint8Array.from({ length: 32 }, (_, i) => i);
const teamDataKey = Uint8Array.from({ length: 32 }, (_, i) => 32 + i);
const userId = "caabe3e9-0000-4000-8000-000000000001";
const workspaceId = "caabe3e9-0000-4000-8000-0000000000a1";
const outboxId = "caabe3e9-0000-4000-8000-0000000000b1";
const keys = await deriveUserKeys(dataKey, userId);
const team = await deriveTeamKeys(teamDataKey, workspaceId);
const nonce = (start: number) => Array.from({ length: 12 }, (_, i) => start + i);

const fields = [
  { field: "body", place: "outbox.body", row: outboxId, plaintext: "Hi Sam,\n\nThe plans are attached.\n\nThanks", nonce: nonce(100) },
  { field: "address", place: "outbox.to_addresses", row: outboxId, plaintext: "sam@example.com", nonce: nonce(120) },
  { field: "filename", place: "outbox_attachments.filename", row: `${outboxId}:${userId}/outbox/caabe3e9-0000-4000-8000-0000000000c1/file`, plaintext: "Café plans.pdf", nonce: nonce(140) },
  { field: "subject", place: "messages.subject", row: "", plaintext: "Café ☕ résumé ½", nonce: nonce(160) },
  { field: "subject", place: "", row: "", plaintext: "", nonce: nonce(180) },
];
const teamFields = [
  { field: "name", place: "threads.share_label", row: "", plaintext: "Acme Holdings", nonce: nonce(200) },
  { field: "body", place: "messages.body_text", row: "caabe3e9-0000-4000-8000-0000000000d1", plaintext: "Shared with the team.", nonce: nonce(220) },
];
const plain = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 255, 1, 2, 3]);
const files = [
  { owner: "user", field: "outbox_file_data", where: `attachments/${userId}/outbox/caabe3e9-0000-4000-8000-0000000000c1/file`, nonce: nonce(50) },
  { owner: "team", field: "attachment_data", where: `attachments/team/${workspaceId}/caabe3e9-0000-4000-8000-0000000000e1`, nonce: nonce(70) },
];

console.log(JSON.stringify({
  dataKeyHex: Buffer.from(dataKey).toString("hex"),
  teamDataKeyHex: Buffer.from(teamDataKey).toString("hex"),
  userId,
  workspaceId,
  fields: await Promise.all(fields.map(async (c) => ({ ...c, ciphertext: await encryptAt(keys, c.field, { place: c.place, row: c.row }, c.plaintext, Uint8Array.from(c.nonce)) }))),
  teamFields: await Promise.all(teamFields.map(async (c) => ({ ...c, ciphertext: await encryptTeamAt(team, c.field, { place: c.place, row: c.row }, c.plaintext, Uint8Array.from(c.nonce)) }))),
  files: await Promise.all(files.map(async (f) => {
    const sealed = f.owner === "user"
      ? await encryptBytesAt(keys, f.field, f.where, plain, Uint8Array.from(f.nonce))
      : await encryptTeamBytesAt(team, f.field, f.where, plain, Uint8Array.from(f.nonce));
    return { ...f, plainHex: Buffer.from(plain).toString("hex"), sealedHex: Buffer.from(sealed).toString("hex") };
  })),
}, null, 2));
