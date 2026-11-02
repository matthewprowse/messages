// Tests for spec.ts and templates.ts: lists typed by hand, a setup surviving a round trip through its stored JSON, the checks that
// stop an automation matching every email or promising a draft it cannot address, and the gallery templates being valid.

import assert from "node:assert/strict";
import { test } from "node:test";
import { customSpec, TEMPLATES, templateOf } from "./templates";
import { doSummary, fieldKey, parseSpec, specProblem, specText, splitList, whenSummary } from "./spec";

test("a typed list is split on commas and lines, trimmed and kept without repeats", () => {
  assert.deepEqual(splitList(" a.com, B.com\nb.COM ,, "), ["a.com", "B.com"]);
  assert.equal(splitList(Array.from({ length: 40 }, (_, i) => `w${i}`).join(",")).length, 20);
  assert.deepEqual(splitList(""), []);
});

test("a setup survives its stored JSON and bad JSON is refused", () => {
  for (const t of TEMPLATES) assert.deepEqual(parseSpec(specText(t.spec)), t.spec);
  assert.equal(parseSpec("not json"), null);
  assert.equal(parseSpec(null), null);
  assert.equal(parseSpec('{"name":""}'), null);
  assert.equal(parseSpec("[1]"), null);
});

test("the gallery templates are valid, have a source and match only their own portal", () => {
  assert.deepEqual(TEMPLATES.map((t) => t.key), ["property24", "private_property"]);
  for (const t of TEMPLATES) {
    assert.equal(specProblem(t.spec, false), null);
    assert.equal(t.spec.do.source, t.name);
    assert.equal(templateOf(t.key), t);
  }
  assert.deepEqual(TEMPLATES[0].spec.when.senders, ["property24.com"]);
  assert.deepEqual(TEMPLATES[1].spec.when.senders, ["privateproperty.co.za"]);
  assert.equal(templateOf(null), undefined);
});

test("an automation with no condition, no way to reach the lead or an unaddressable draft cannot be saved", () => {
  const s = customSpec();
  assert.match(specProblem({ ...s, name: "x" }, true) ?? "", /at least one condition/);
  const withWhen = { ...s, name: "x", when: { ...s.when, senders: ["forms.example.com"] } };
  assert.equal(specProblem(withWhen, true), null);
  assert.match(specProblem({ ...withWhen, name: "" }, true) ?? "", /name/);
  assert.match(specProblem({ ...withWhen, read: { fields: [{ key: "name", description: "" }] } }, true) ?? "", /email address or a phone/);
  assert.match(specProblem({ ...withWhen, read: { fields: [{ key: "phone", description: "" }] }, do: { ...withWhen.do, draft: true } }, true) ?? "", /Email field/);
  assert.match(specProblem({ ...withWhen, do: { ...withWhen.do, contact: false, task: { title: "Call", minutes: 5 } } }, true) ?? "", /contact/);
  assert.match(specProblem({ ...withWhen, do: { ...withWhen.do, task: { title: "Call", minutes: -1 } } }, true) ?? "", /between/);
});

test("field names become the worker's keys", () => {
  assert.equal(fieldKey("Plot Number"), "plot_number");
  assert.equal(fieldKey("  E-mail  "), "e_mail");
  assert.equal(fieldKey("2nd Phone"), "f_2nd_phone");
  assert.equal(fieldKey("!!!"), "");
});

test("a setup is described in plain words with no dashes", () => {
  const t = TEMPLATES[0].spec;
  assert.equal(whenSummary(t), "From property24.com. Mentions enquiry or inquiry or lead or interested in");
  assert.deepEqual(doSummary(t), ["Adds them as a Lead", "Links the email to them", "Adds the task Call Back Within 5 Minutes", "Writes a reply draft", "Sends an urgent notification"]);
  for (const line of [whenSummary(t), ...doSummary(t), ...TEMPLATES.map((x) => x.description)]) assert.doesNotMatch(line, /[\u2013\u2014]/);
});
