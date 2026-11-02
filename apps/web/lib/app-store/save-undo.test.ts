// Pins down save-undo.ts: a failed save puts back exactly what the change touched, and only the account changes that
// are really stored get through.

import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Account } from "../types";
import { savedAccountPatch, undoFor } from "./save-undo";

// The reducer loads data.ts, which needs a Supabase URL to import, so a fake one is set first.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test";
type Mod = typeof import("./reducer");
let reducer: Mod["reducer"], initial: Mod["initial"], EMPTY_PROFILE: Awaited<typeof import("../data")>["EMPTY_PROFILE"];
before(async () => { ({ reducer, initial } = await import("./reducer")); ({ EMPTY_PROFILE } = await import("../data")); });

const account = (patch: Partial<Account> = {}): Account => ({ id: "a1", provider: "gmail", label: "Gmail", detail: "x", status: "connected", sendAddresses: [], ...patch });
const make = () => ({ ...initial, profile: { ...EMPTY_PROFILE, whatsappReadReceipts: true, about: "Agent" }, accounts: [account()], rules: [{ id: "r1", kind: "always_important" as const, target: "sam.co.za" }], writingExamples: [{ id: "w1", context: "Client", text: "Hi" }] });

test("a failed profile change goes back to the earlier values", () => {
  const state = make();
  const change = { type: "patchProfile" as const, patch: { whatsappReadReceipts: false } };
  const shown = reducer(state, change);
  assert.equal(shown.profile.whatsappReadReceipts, false);
  const back = reducer(shown, undoFor(state, change)!);
  assert.equal(back.profile.whatsappReadReceipts, true);
  assert.equal(back.profile.about, "Agent");
});

test("a failed removal brings the rule and the example back", () => {
  const state = make();
  const rule = { type: "removeRule" as const, id: "r1" };
  assert.deepEqual(reducer(reducer(state, rule), undoFor(state, rule)!).rules, state.rules);
  const example = { type: "removeExample" as const, id: "w1" };
  assert.deepEqual(reducer(reducer(state, example), undoFor(state, example)!).writingExamples, state.writingExamples);
});

test("a failed pause puts the account's status back", () => {
  const state = make();
  const pause = { type: "patchAccount" as const, id: "a1", patch: { status: "disconnected" as const } };
  const back = reducer(reducer(state, pause), undoFor(state, pause)!);
  assert.equal(back.accounts[0].status, "connected");
});

test("only a nickname, pausing and resuming are saved for an account", () => {
  const state = make();
  assert.deepEqual(savedAccountPatch({ nickname: "Work", status: "connected", label: "x" }), { nickname: "Work" });
  assert.deepEqual(savedAccountPatch({ status: "connecting" }), { status: "connecting" });
  assert.deepEqual(savedAccountPatch({ status: "disconnected" }), { status: "disconnected" });
  assert.equal(undoFor(state, { type: "patchAccount", id: "missing", patch: { nickname: "x" } }), null);
});
