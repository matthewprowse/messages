// The re-key job finds a sealed value's field by trying every name in packages/crypto/src/fields.ts, so a field only the
// AI worker knows (apps/ai/ai/fields.py) would read as unreadable and stop a rotation from finishing. This pins the two
// lists to the same names.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FIELD } from "@messages/crypto/fields";

test("fields.py names exactly the fields fields.ts does", () => {
  const py = readFileSync(new URL("../../../ai/ai/fields.py", import.meta.url), "utf8");
  const names = new Set([...py.matchAll(/^[A-Z_]+\s*=\s*"([a-z_]+)"/gm)].map((m) => m[1]));
  assert.deepEqual([...names].sort(), [...new Set(Object.values(FIELD) as string[])].sort());
});
