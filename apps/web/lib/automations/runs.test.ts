// Tests for runs.ts: run history wording. Known codes become sentences, unknown ones never leak raw, and nothing has a dash.

import assert from "node:assert/strict";
import { test } from "node:test";
import { errorText, readByText, runWho, STATUS_LABEL } from "./runs";

test("error codes and lists of failed steps become sentences", () => {
  assert.equal(errorText(null), null);
  assert.match(errorText("unreadable") ?? "", /did not have a name/);
  assert.match(errorText("task,draft") ?? "", /task could not be added.*draft could not be made/);
  assert.equal(errorText("some_new_code"), "Something went wrong.");
});

test("the person a run was about falls back from name to address to number", () => {
  assert.equal(runWho({ name: "Sipho", email: "s@x.co" }), "Sipho");
  assert.equal(runWho({ name: " ", email: "s@x.co" }), "s@x.co");
  assert.equal(runWho({ phone: "+27821234567" }), "+27821234567");
  assert.equal(runWho(null), "An email");
});

test("how it was read is said plainly and no wording has a dash", () => {
  assert.equal(readByText("gemini"), "Read by the AI");
  assert.equal(readByText("parser"), "Read by the fixed reader");
  assert.equal(readByText(null), "");
  for (const text of [...Object.values(STATUS_LABEL), errorText("unreadable,ai_paused,task,name") ?? ""]) assert.doesNotMatch(text, /[\u2013\u2014]/);
});
