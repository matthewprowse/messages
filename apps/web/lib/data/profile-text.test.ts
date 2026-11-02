// Pins down plainColumns: only non-empty readable text counts as needing a seal.

import test from "node:test";
import assert from "node:assert/strict";
import { plainColumns } from "./profile-text";

test("plain text needs sealing, sealed or empty text does not", () => {
  assert.deepEqual(plainColumns({ about: "Estate agent", important_people: "Sam" }), ["about", "important_people"]);
  assert.deepEqual(plainColumns({ about: "e1:abcdef", important_people: "" }), []);
  assert.deepEqual(plainColumns({ about: null, important_people: "Sam" }), ["important_people"]);
  assert.deepEqual(plainColumns(null), []);
});
