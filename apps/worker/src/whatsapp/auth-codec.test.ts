// Tests for whatsapp/auth-codec.ts: session values survive sealing and opening with Buffers intact, another
// user's key or account cannot open them, and rows sealed under the old static key still open.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { initAuthCreds, type AuthenticationCreds } from "baileys";
import { makeSealer } from "../crypto";
import { encrypt } from "../crypto";
import { decodeKey, encodeKey } from "./auth-codec";

const credKey = Uint8Array.from(randomBytes(32));
const sealer = makeSealer("account-1", async () => [credKey], "");

test("credentials survive a round trip, Buffers included", async () => {
  const creds = initAuthCreds();
  const sealed = await encodeKey(creds, sealer);
  assert.ok(sealed.startsWith("v2:"));
  assert.ok(!sealed.includes(creds.advSecretKey));
  const back = await decodeKey<AuthenticationCreds>("creds", sealed, sealer);
  assert.deepEqual(Buffer.from(back.noiseKey.private), Buffer.from(creds.noiseKey.private));
  assert.equal(back.registrationId, creds.registrationId);
});

test("Signal session bytes come back as bytes", async () => {
  const session = randomBytes(64);
  const back = await decodeKey<Uint8Array>("session", await encodeKey(session, sealer), sealer);
  assert.deepEqual(Buffer.from(back), session);
});

test("app state sync keys come back as protobuf objects", async () => {
  const value = { keyData: randomBytes(32), timestamp: 5 };
  const back = await decodeKey<{ keyData: Uint8Array }>("app-state-sync-key", await encodeKey(value, sealer), sealer);
  assert.deepEqual(Buffer.from(back.keyData), value.keyData);
  assert.equal(typeof (back as { toJSON?: unknown }).toJSON, "function");
});

test("another user's key, or another account, cannot read it", async () => {
  const sealed = await encodeKey({ a: 1 }, sealer);
  await assert.rejects(decodeKey("creds", sealed, makeSealer("account-1", async () => [Uint8Array.from(randomBytes(32))], "")));
  await assert.rejects(decodeKey("creds", sealed, makeSealer("account-2", async () => [credKey], "")));
});

test("a session sealed under the old static key still opens, for the rows credentials:reseal has not moved", async () => {
  const legacy = randomBytes(32).toString("base64");
  const old = encrypt(JSON.stringify({ a: 1 }), legacy);
  assert.deepEqual(await decodeKey("creds", old, makeSealer("account-1", async () => [credKey], legacy)), { a: 1 });
  await assert.rejects(decodeKey("creds", old, sealer), /ENCRYPTION_KEY/);
});
