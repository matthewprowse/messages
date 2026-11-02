// Tests for whatsapp/quiet-signal.ts: libsignal's output is dropped (by origin and by wording), key-shaped text is redacted, other output passes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, quietSignalLogs, redact } from "./quiet-signal";

test("libsignal's session dumps are dropped; other console output passes through", () => {
  const seen: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => void seen.push(args);
  try {
    quietSignalLogs();
    console.info("Closing session:", { privKey: Buffer.from("secret") });
    console.info("Opening session:", {});
    console.info('{"level":"info","msg":"worker starting"}');
    console.info("something else");
  } finally {
    console.info = original;
  }
  assert.deepEqual(seen, [['{"level":"info","msg":"worker starting"}'], ["something else"]]);
});

const SIGNAL_STACK = "Error\n    at SessionRecord.log (/app/node_modules/.pnpm/libsignal@6.0.0/node_modules/libsignal/src/session_record.js:12:5)";

test("a call from the libsignal stack is dropped whatever it says", () => {
  assert.equal(decide(["A brand new reworded line", { privKey: Buffer.from("k") }], SIGNAL_STACK), "drop");
  assert.equal(decide(["x"], "Error\n    at f (/app/node_modules/baileys/lib/Socket/socket.js:1:1)"), "drop");
});

test("known wordings are dropped without a stack, and a failed decrypt is counted", () => {
  assert.equal(decide(["Closing session: x"], "Error\n at app.js"), "drop");
  assert.equal(decide(["Failed to decrypt message with any known session..."], "Error\n at app.js"), "decrypt-failed");
});

test("the worker's own JSON lines and unrelated output pass", () => {
  assert.equal(decide(['{"t":"2026","level":"info"}'], SIGNAL_STACK), "pass");
  assert.equal(decide(["plain"], "Error\n at /app/apps/worker/src/index.ts:1:1"), "pass");
});

test("key-shaped text and raw bytes are redacted", () => {
  assert.equal(redact(`key ${"a".repeat(64)} end`), "key [redacted] end");
  assert.equal(redact(`b64 ${"Zm9vYmFy".repeat(8)}`), "b64 [redacted]");
  assert.equal(redact(Buffer.from("secret")), "[bytes]");
  assert.equal(redact({ privKey: 1 }), "[object]");
  assert.equal(redact("short text"), "short text");
  assert.equal(redact(3), 3);
});
