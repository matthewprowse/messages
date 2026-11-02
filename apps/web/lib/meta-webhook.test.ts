// Tests for meta-webhook.ts: the verify handshake, the signature check, and that hints carry no message content.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { hintsFromPayload, validSignature, verifyChallenge } from "./meta-webhook";

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const q = (o: Record<string, string>) => new URLSearchParams(o);

test("the handshake echoes the challenge only for the right token", () => {
  assert.equal(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "123" }), "tok"), "123");
  assert.equal(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "123" }), "tok"), null);
  assert.equal(verifyChallenge(q({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "123" }), "tok"), null);
  assert.equal(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "tok" }), "tok"), null);
});

test("the handshake is refused when no token is configured, even an empty one sent", () => {
  assert.equal(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), ""), null);
  assert.equal(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1" }), undefined), null);
});

test("a signature must be the HMAC of the exact body under the app secret", () => {
  const body = '{"object":"instagram","entry":[]}';
  assert.equal(validSignature(body, sign(body, "s3cret"), "s3cret"), true);
  assert.equal(validSignature(body + " ", sign(body, "s3cret"), "s3cret"), false);
  assert.equal(validSignature(body, sign(body, "other"), "s3cret"), false);
});

test("a missing, malformed or unconfigured signature never passes", () => {
  const body = "{}";
  assert.equal(validSignature(body, null, "s"), false);
  assert.equal(validSignature(body, "sha256=abc", "s"), false);
  assert.equal(validSignature(body, "sha1=" + "0".repeat(40), "s"), false);
  assert.equal(validSignature(body, sign(body, ""), ""), false);
  assert.equal(validSignature(body, sign(body, "s"), undefined), false);
});

test("a payload becomes one content-free hint per account and kind", () => {
  const hints = hintsFromPayload({
    object: "instagram",
    entry: [
      { id: "111", time: 1, messaging: [{ sender: { id: "9" }, message: { mid: "m1", text: "secret words" } }, { sender: { id: "8" }, message: { mid: "m2" } }, { read: { mid: "m0" } }] },
      { id: "222", messaging: [{ reaction: { mid: "m", reaction: "love" } }] },
    ],
  });
  assert.deepEqual(hints, [{ igUserId: "111", kind: "message" }, { igUserId: "111", kind: "seen" }, { igUserId: "222", kind: "reaction" }]);
  assert.equal(JSON.stringify(hints).includes("secret"), false);
});

test("echoes of the account's own messages, other objects and bad ids give no hints", () => {
  assert.deepEqual(hintsFromPayload({ object: "instagram", entry: [{ id: "1", messaging: [{ message: { is_echo: true, text: "x" } }] }] }), []);
  assert.deepEqual(hintsFromPayload({ object: "page", entry: [{ id: "1", messaging: [{ message: {} }] }] }), []);
  assert.deepEqual(hintsFromPayload({ object: "instagram", entry: [{ id: "abc", messaging: [{ message: {} }] }, { messaging: [{ message: {} }] }] }), []);
  assert.deepEqual(hintsFromPayload({ object: "instagram", entry: [{ id: "1", changes: [{ field: "comments" }] }] }), []);
  assert.deepEqual(hintsFromPayload(null), []);
  assert.deepEqual(hintsFromPayload("x"), []);
});
