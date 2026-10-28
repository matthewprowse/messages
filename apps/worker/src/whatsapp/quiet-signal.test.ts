// Tests for whatsapp/quiet-signal.ts: libsignal's session dumps are dropped and other console output passes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { quietSignalLogs } from "./quiet-signal";

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
