// Tests for feature-flags.ts: ordering, the people box, change detection and the short cache of the signed-in person's switches.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { flagChanged, flagLabel, flagOn, orderFlags, parseEmails, readFlagState, resetFlagState, FLAGS } from "./feature-flags";

beforeEach(() => resetFlagState());

const flag = (key: string, enabled = false, emails: string[] = []) => ({ key, enabled, description: "", emails, updated_at: "" });

test("every seeded switch is listed once with a Title Case label", () => {
  assert.equal(new Set(FLAGS.map((f) => f.key)).size, 7);
  for (const f of FLAGS) assert.match(f.label, /^[A-Z]/);
  assert.equal(flagLabel("disable_sends"), "Disable Sends");
  assert.equal(flagLabel("something_new"), "something_new");
});

test("known switches come in the listed order and unknown ones after, by key", () => {
  const out = orderFlags([flag("zzz"), flag("disable_sends"), flag("aaa"), flag("pause_all_ai")]).map((f) => f.key);
  assert.deepEqual(out, ["pause_all_ai", "disable_sends", "aaa", "zzz"]);
});

test("the people box takes emails split by commas, spaces or lines, lowercased and without repeats", () => {
  assert.deepEqual(parseEmails("A@x.test, b@x.test\nA@X.test"), { ok: true, emails: ["a@x.test", "b@x.test"] });
  assert.deepEqual(parseEmails("   "), { ok: true, emails: [] });
  assert.deepEqual(parseEmails("a@x.test nope"), { ok: false, bad: "nope" });
});

test("a row is changed when the switch or the people differ, whatever their order", () => {
  const row = flag("pause_all_ai", true, ["a@x.test", "b@x.test"]);
  assert.equal(flagChanged(row, true, ["b@x.test", "a@x.test"]), false);
  assert.equal(flagChanged(row, false, ["a@x.test", "b@x.test"]), true);
  assert.equal(flagChanged(row, true, ["a@x.test"]), true);
});

test("only a true value in the state map is a switch that is on", () => {
  assert.equal(flagOn({ disable_sends: true }, "disable_sends"), true);
  assert.equal(flagOn({ disable_sends: "true" }, "disable_sends"), false);
  assert.equal(flagOn(null, "disable_sends"), false);
  assert.equal(flagOn({}, "disable_sends"), false);
});

test("the state is cached for 30 seconds, and a failure answers all off without caching", async () => {
  let reads = 0;
  const read = async () => { reads++; return { disable_sends: true }; };
  assert.deepEqual(await readFlagState(read, 1000), { disable_sends: true });
  await readFlagState(read, 30_999);
  assert.equal(reads, 1);
  await readFlagState(read, 31_000);
  assert.equal(reads, 2);
  resetFlagState();
  assert.deepEqual(await readFlagState(async () => { throw new Error("down"); }, 0), {});
  assert.deepEqual(await readFlagState(read, 1), { disable_sends: true });
});
