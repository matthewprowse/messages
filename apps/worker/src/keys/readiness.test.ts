// keys/readiness.ts: a static key is ready to remove only when every count that needs it is zero, and a count that could
// not be read keeps it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECKS, readinessVerdict } from "./readiness";

const counts = (n: (table: string, column: string) => number | null) => CHECKS.map((c) => ({ what: `${c.table}.${c.column}`, needs: c.needs, fix: c.fix, count: n(c.table, c.column) }));

test("with nothing left under either static key both can go", () => {
  assert.deepEqual(readinessVerdict(counts(() => 0)), { ready: { KEY_WRAPPING_KEY: true, ENCRYPTION_KEY: true }, blocking: [] });
});

test("a local:v1 key keeps KEY_WRAPPING_KEY and a v1 sign-in keeps ENCRYPTION_KEY, each on its own", () => {
  const wrapping = readinessVerdict(counts((t, c) => (t === "team_keys" ? 2 : 0)));
  assert.deepEqual(wrapping.ready, { KEY_WRAPPING_KEY: false, ENCRYPTION_KEY: true });
  assert.equal(wrapping.blocking[0].what, "team_keys.wrapped_by");
  const legacy = readinessVerdict(counts((t, c) => (t === "instagram_sign_ins" && c === "code" ? 1 : 0)));
  assert.deepEqual(legacy.ready, { KEY_WRAPPING_KEY: true, ENCRYPTION_KEY: false });
});

test("a count that could not be read blocks its key", () => {
  assert.equal(readinessVerdict(counts((t) => (t === "whatsapp_auth_keys" ? null : 0))).ready.ENCRYPTION_KEY, false);
});

test("every check names a fix, and both keys are covered", () => {
  assert.ok(CHECKS.every((c) => c.fix.length > 0));
  assert.deepEqual([...new Set(CHECKS.map((c) => c.needs))].sort(), ["ENCRYPTION_KEY", "KEY_WRAPPING_KEY"]);
});
