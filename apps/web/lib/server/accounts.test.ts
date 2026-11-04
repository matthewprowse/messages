// accounts.ts: the old static ENCRYPTION_KEY is only read now. A "v1:" value opens while it is set, and nothing is sealed
// with it any more. (The handoffs themselves are tested in handoff.test.ts.)

import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { test } from "node:test";

// accounts.ts reads ENCRYPTION_KEY when it loads, so it is imported after the key is set.
const legacyKey = randomBytes(32);
process.env.ENCRYPTION_KEY = legacyKey.toString("base64");
const accounts = import("./accounts");

function sealV1(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

test("a v1 value from before per-user keys still opens with the static key", async () => {
  const { openJson } = await accounts;
  assert.deepEqual(openJson(sealV1({ code: "123456" }, legacyKey)), { code: "123456" });
  assert.throws(() => openJson(sealV1({ code: "1" }, randomBytes(32))));
  assert.throws(() => openJson("v2:abc"), (err: { code?: string }) => err.code === "unknown_format");
});

test("nothing in accounts.ts seals with the static key any more", async () => {
  const mod = (await accounts) as Record<string, unknown>;
  assert.equal(mod.sealJson, undefined);
});
