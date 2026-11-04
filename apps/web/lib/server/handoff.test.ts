// handoff.ts: a sign-in cookie opens only for the purpose and user it was sealed for, under that user's own key (during a
// rotation, an older one too), and a handoff stored in a row opens only in that column of that row; old static-key
// cookies are refused and old "v1:" row values go to the legacy reader.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { deriveCredentialKey } from "@messages/crypto/wrap";
import { cookieUser, openCookie, openRowHandoff, sealCookie, sealRowHandoff } from "./handoff";

const userId = "0b6a3c1e-7f2d-4c55-9a1b-2e3f4a5b6c7d";
const signIn = { userId, state: "s1", verifier: "v1", expires: 2_000 };
const keyOf = (n: number) => deriveCredentialKey(Uint8Array.from({ length: 32 }, () => n));
const noLegacy = () => {
  throw new Error("not a v1 value");
};

test("a cookie opens for its own purpose and user, and names the user before it is opened", async () => {
  const key = await keyOf(1);
  const sealed = await sealCookie(key, signIn, "google_connect");
  assert.ok(sealed.startsWith(`h2:${userId}.`));
  assert.ok(!sealed.includes("verifier"));
  assert.equal(cookieUser(sealed), userId);
  assert.deepEqual(await openCookie([key], sealed, "google_connect"), signIn);
});

test("a cookie sealed for one flow, or under another user's key, does not open", async () => {
  const key = await keyOf(1);
  await assert.rejects(openCookie([key], await sealCookie(key, signIn, "zoom_connect"), "google_connect"));
  await assert.rejects(openCookie([await keyOf(2)], await sealCookie(key, signIn, "google_connect"), "google_connect"));
});

test("changing the user id in the clear breaks the seal", async () => {
  const key = await keyOf(1);
  const sealed = await sealCookie(key, signIn, "microsoft_connect");
  const other = "1b6a3c1e-7f2d-4c55-9a1b-2e3f4a5b6c7d";
  await assert.rejects(openCookie([key], sealed.replace(userId, other), "microsoft_connect"));
});

test("during a rotation a cookie sealed under the old key still opens", async () => {
  const [current, previous] = await Promise.all([keyOf(3), keyOf(4)]);
  const sealed = await sealCookie(previous, signIn, "instagram_connect");
  assert.deepEqual(await openCookie([current, previous], sealed, "instagram_connect"), signIn);
});

test("an old static-key cookie, junk, or a value without a user id is refused", async () => {
  const key = await keyOf(1);
  const oldCookie = `h1:${userId}.${randomBytes(48).toString("base64")}`;
  assert.equal(cookieUser(oldCookie), null);
  await assert.rejects(openCookie([key], oldCookie, "google_connect"), (err: { code?: string }) => err.code === "handoff_format");
  await assert.rejects(openCookie([key], "h2:nope.AAAA", "google_connect"));
  await assert.rejects(openCookie([key], `h2:${userId}.AAAA`, "google_connect"));
  await assert.rejects(sealCookie(key, { userId: "" }, "google_connect"), (err: { code?: string }) => err.code === "handoff_no_user");
});

test("a row handoff opens only in its own column and row", async () => {
  const key = await keyOf(5);
  const row = "5e7a0c1d-0000-4000-8000-0000000000d2";
  const value = { appleId: "a@b.com", password: "pw" };
  const sealed = await sealRowHandoff(key, { table: "icloud_setups", column: "sign_in" }, row, value);
  assert.ok(sealed.startsWith("v2:"));
  assert.deepEqual(await openRowHandoff(async () => [key], noLegacy, { table: "icloud_setups", column: "sign_in" }, row, sealed), value);
  await assert.rejects(openRowHandoff(async () => [key], noLegacy, { table: "icloud_setups", column: "result" }, row, sealed));
  await assert.rejects(openRowHandoff(async () => [key], noLegacy, { table: "icloud_setups", column: "sign_in" }, "5e7a0c1d-0000-4000-8000-0000000000d3", sealed));
  await assert.rejects(openRowHandoff(async () => [key], noLegacy, { table: "instagram_sign_ins", column: "code" }, row, sealed));
});

test("a v1 row handoff goes to the legacy reader and never asks for the user's keys", async () => {
  let asked = false;
  const keys = async () => {
    asked = true;
    return [];
  };
  assert.deepEqual(await openRowHandoff(keys, (v) => ({ legacy: v }), { table: "instagram_sign_ins", column: "code" }, "acc", "v1:abc"), { legacy: "v1:abc" });
  assert.equal(asked, false);
  await assert.rejects(openRowHandoff(async () => [], noLegacy, { table: "instagram_sign_ins", column: "code" }, "acc", "zz:abc"));
});
