import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { initAuthCreds, type AuthenticationCreds } from "baileys";
import { decodeKey, encodeKey } from "./auth-codec";

const key = randomBytes(32).toString("base64");

test("credentials survive a round trip, Buffers included", () => {
  const creds = initAuthCreds();
  const sealed = encodeKey(creds, key);
  assert.ok(sealed.startsWith("v1:"));
  assert.ok(!sealed.includes(creds.advSecretKey));
  const back = decodeKey<AuthenticationCreds>("creds", sealed, key);
  assert.deepEqual(Buffer.from(back.noiseKey.private), Buffer.from(creds.noiseKey.private));
  assert.equal(back.registrationId, creds.registrationId);
});

test("Signal session bytes come back as bytes", () => {
  const session = randomBytes(64);
  const back = decodeKey<Uint8Array>("session", encodeKey(session, key), key);
  assert.deepEqual(Buffer.from(back), session);
});

test("app state sync keys come back as protobuf objects", () => {
  const value = { keyData: randomBytes(32), timestamp: 5 };
  const back = decodeKey<{ keyData: Uint8Array }>("app-state-sync-key", encodeKey(value, key), key);
  assert.deepEqual(Buffer.from(back.keyData), value.keyData);
  assert.equal(typeof (back as { toJSON?: unknown }).toJSON, "function");
});

test("another key cannot read it", () => {
  assert.throws(() => decodeKey("creds", encodeKey({ a: 1 }, key), randomBytes(32).toString("base64")));
});
