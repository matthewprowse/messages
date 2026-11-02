// rule-note.ts: what each kind of learned style rule says about itself.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ruleNote } from "./rule-note";

const base = { who: "", supportCount: 1, enabled: true, disabledReason: null };

test("a tentative rule says it is still being learned", () => {
  assert.equal(ruleNote({ ...base, enabled: false, disabledReason: "tentative" }), "Everyone · Learning: seen once");
  assert.equal(ruleNote({ ...base, who: "Ann", enabled: false, disabledReason: "tentative" }), "For Ann · Learning: seen once");
});

test("a rule the person turned on stops saying it is learning", () => {
  assert.equal(ruleNote({ ...base, supportCount: 1 }), "Everyone");
  assert.equal(ruleNote({ ...base, supportCount: 3 }), "Everyone · Seen 3 times");
});

test("unsupported and user-disabled rules keep their notes", () => {
  assert.equal(ruleNote({ ...base, supportCount: 2, enabled: false, disabledReason: "unsupported" }), "Everyone · Seen 2 times · No Longer Seen In Your Mail");
  assert.equal(ruleNote({ ...base, enabled: false, disabledReason: "user" }), "Everyone");
});
