// Tests for scripts/check-baileys.mjs: a matching install passes, and a changed version or WASM hash is reported.
// Run by CI with `node --test scripts/check-baileys.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compare } from "./check-baileys.mjs";

const lock = { baileys: "1.0.0", libsignal: "6.0.0", "whatsapp-rust-bridge": { version: "0.5.4", files: { "dist/index.js": "aa" } } };
const same = () => ({ baileys: "1.0.0", libsignal: "6.0.0", bridge: { version: "0.5.4", files: { "dist/index.js": "aa" } } });

test("an install that matches the lock has no problems", () => assert.deepEqual(compare(lock, same()), []));

test("a different Baileys, libsignal or bridge version is reported", () => {
  const i = same();
  i.baileys = "1.0.1";
  i.libsignal = "6.0.1";
  i.bridge.version = "0.5.5";
  assert.equal(compare(lock, i).length, 3);
});

test("a changed WASM hash is reported, and so is a missing file", () => {
  const changed = same();
  changed.bridge.files["dist/index.js"] = "bb";
  assert.match(compare(lock, changed)[0], /sha256 is bb, lock says aa/);
  const missing = same();
  missing.bridge.files = {};
  assert.equal(compare(lock, missing).length, 1);
});
