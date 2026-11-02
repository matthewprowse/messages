// Tests for the Graph notification checks: clientState signing, forged and malformed notifications, and batching.

import { test } from "node:test";
import assert from "node:assert/strict";
import { accountFromClientState, accountsToHint, clientStateFor } from "./graph-notify";

const A = "123e4567-e89b-42d3-a456-426614174000";
const B = "223e4567-e89b-42d3-a456-426614174001";
const SECRET = "test-secret";

test("a clientState made for an account gives that account back", () => {
  assert.equal(accountFromClientState(clientStateFor(A, SECRET), SECRET), A);
});

test("the signing matches the worker's (the same fixed value is pinned in its test)", () => {
  assert.equal(clientStateFor(A, SECRET), `${A}.NNEtxoqKNT-iaypS6DHgth5deJFRIsEvoJTTRb2oA_U`);
});

test("a wrong secret, a tampered account or a missing secret is refused", () => {
  const state = clientStateFor(A, SECRET);
  assert.equal(accountFromClientState(state, "other"), null);
  assert.equal(accountFromClientState(state.replace(A, B), SECRET), null);
  assert.equal(accountFromClientState(state, ""), null);
});

test("malformed clientStates are refused", () => {
  for (const bad of [undefined, null, 5, "", "no-dot", ".sig", `${A}.`, "x".repeat(200), `not-a-uuid.${"a".repeat(43)}`]) {
    assert.equal(accountFromClientState(bad, SECRET), null);
  }
});

test("a notification body gives each valid account once, and drops forged entries", () => {
  const body = {
    value: [
      { clientState: clientStateFor(A, SECRET) },
      { clientState: clientStateFor(A, SECRET) },
      { clientState: clientStateFor(B, "forged") },
      { clientState: clientStateFor(B, SECRET) },
      { nothing: true },
    ],
  };
  assert.deepEqual(accountsToHint(body, SECRET).sort(), [A, B].sort());
});

test("a body that is not a notification gives nothing", () => {
  assert.deepEqual(accountsToHint(null, SECRET), []);
  assert.deepEqual(accountsToHint({ value: "x" }, SECRET), []);
  assert.deepEqual(accountsToHint({}, SECRET), []);
});
