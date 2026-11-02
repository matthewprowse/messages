// Tests for flags.ts: which switches apply to whom, the cache, and that a failed read never throws or switches anything on.

import assert from "node:assert/strict";
import { test } from "node:test";
import { connectorBlocked, connectorFlag, flagIsOn, SENDS_FLAG, Flags, type FlagRow } from "./flags";

const row = (key: string, enabled: boolean, user_ids: string[] | null = []): FlagRow => ({ key, enabled, user_ids });
const rows = (...r: FlagRow[]) => new Map(r.map((x) => [x.key, x]));

test("a switch that is off, or not in the table, is never on", () => {
  assert.equal(flagIsOn(rows(row("disable_sends", false)), "disable_sends"), false);
  assert.equal(flagIsOn(rows(), "disable_sends", "u1"), false);
});

test("a switch with no people applies to everyone", () => {
  const r = rows(row("disable_sends", true, []), row("pause_all_ai", true, null));
  assert.equal(flagIsOn(r, "disable_sends", "u1"), true);
  assert.equal(flagIsOn(r, "disable_sends"), true);
  assert.equal(flagIsOn(r, "pause_all_ai", "u2"), true);
});

test("a switch limited to people applies to them only, and not to a check with no person", () => {
  const r = rows(row("disable_sends", true, ["u1"]));
  assert.equal(flagIsOn(r, "disable_sends", "u1"), true);
  assert.equal(flagIsOn(r, "disable_sends", "u2"), false);
  assert.equal(flagIsOn(r, "disable_sends"), false);
});

test("the connector switch is named for the provider", () => {
  assert.equal(connectorFlag("instagram"), "disable_connector_instagram");
});

test("rows are cached for the cache time, then read again", async () => {
  let loads = 0;
  let t = 0;
  const f = new Flags(async () => { loads++; return [row("disable_sends", loads > 1)]; }, { ttlMs: 1000, now: () => t });
  assert.equal(await f.on("disable_sends"), false);
  t = 999;
  assert.equal(await f.on("disable_sends"), false);
  assert.equal(loads, 1);
  t = 1000;
  assert.equal(await f.on("disable_sends"), true);
  assert.equal(loads, 2);
});

test("calls made while a read runs share it", async () => {
  let loads = 0;
  const f = new Flags(async () => { loads++; return [row("pause_all_ai", true)]; });
  const answers = await Promise.all([f.on("pause_all_ai"), f.on("pause_all_ai"), f.on("pause_all_ai")]);
  assert.deepEqual(answers, [true, true, true]);
  assert.equal(loads, 1);
});

test("a failed read keeps the last good rows, reports a code and does not throw", async () => {
  let fail = false;
  let t = 0;
  const codes: string[] = [];
  const f = new Flags(async () => { if (fail) throw Object.assign(new Error("x"), { code: "PGRST205" }); return [row("disable_sends", true)]; }, { ttlMs: 10, now: () => t, onError: (c) => codes.push(c) });
  assert.equal(await f.on("disable_sends"), true);
  fail = true;
  t = 50;
  assert.equal(await f.on("disable_sends"), true);
  assert.deepEqual(codes, ["PGRST205"]);
});

test("before any read has worked, every switch is off", async () => {
  const f = new Flags(async () => { throw new Error("down"); }, { onError: () => undefined });
  assert.equal(await f.on("disable_sends"), false);
});

test("a connector is blocked by its provider's switch only, for everyone or for the people listed", async () => {
  const f = new Flags(async () => [row("disable_connector_instagram", true), row("disable_connector_linkedin", true, ["u1"])]);
  await f.refresh();
  assert.equal(connectorBlocked(f, "instagram", "u9"), true);
  assert.equal(connectorBlocked(f, "linkedin", "u1"), true);
  assert.equal(connectorBlocked(f, "linkedin", "u2"), false);
  assert.equal(connectorBlocked(f, "gmail", "u1"), false);
});

test("the send switch holds sends for everyone once thrown", async () => {
  const f = new Flags(async () => [row(SENDS_FLAG, true)]);
  assert.equal(await f.on(SENDS_FLAG, "u1"), true);
});
