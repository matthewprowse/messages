// Tests for contact-patch.ts: what the store holds after a merge, a change of kind and an id repoint.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Contact } from "../types";
import { mergeContactInto, patchContactIn, repointIds } from "./contact-patch";

const contact = (id: string, name: string, extra: Partial<Contact> = {}): Contact => ({ id, name, initials: "X", hue: 0, emails: [], phones: [], isCompany: false, ...extra });

test("a merge gives the kept contact both sets of addresses and removes the other", () => {
  const list = [
    contact("a", "Sam", { emails: ["sam@x.com"], role: "Agent" }),
    contact("b", "Sam Jones", { emails: ["sam@x.com", "sj@y.com"], phones: ["+27821234567"], role: "Owner", company: "Jones Co", handles: ["samj"] }),
    contact("c", "Other"),
  ];
  const out = mergeContactInto(list, "a", "b");
  assert.deepEqual(out.map((c) => c.id), ["a", "c"]);
  const kept = out[0];
  assert.deepEqual(kept.emails, ["sam@x.com", "sj@y.com"]);
  assert.deepEqual(kept.phones, ["+27821234567"]);
  assert.deepEqual(kept.handles, ["samj"]);
  assert.equal(kept.role, "Agent"); // its own value stays
  assert.equal(kept.company, "Jones Co"); // a blank is filled from the other
  assert.equal(kept.name, "Sam");
});

test("a name chosen in the merge dialog is kept", () => {
  const out = mergeContactInto([contact("a", "Sam"), contact("b", "Samantha Jones")], "a", "b", "Samantha Jones");
  assert.equal(out[0].name, "Samantha Jones");
});

test("a merge of someone the store does not hold changes nothing", () => {
  const list = [contact("a", "Sam")];
  assert.equal(mergeContactInto(list, "a", "zzz"), list);
});

test("merging into a company sender and a person with a phone re-decides person or company", () => {
  const brand = contact("a", "Acme", { emails: ["noreply@acme.com"], organization: { id: "o", name: "Acme" }, isCompany: true });
  const person = contact("b", "Acme", { phones: ["+27821234567"] });
  assert.equal(mergeContactInto([brand, person], "a", "b")[0].isCompany, false);
});

test("repointing replaces the merged id once", () => {
  assert.deepEqual(repointIds(["x", "b", "a"], "a", "b"), ["x", "a"]);
  const same = ["x", "y"];
  assert.equal(repointIds(same, "a", "b"), same);
});

test("a kind override moves a sender between people and companies", () => {
  const sender = contact("a", "Acme Team", { emails: ["team@acme.com"], organization: { id: "o", name: "Acme" }, isCompany: true });
  assert.equal(patchContactIn([sender], "a", { kindOverride: "person" })[0].isCompany, false);
  const person = contact("p", "Thandi", { emails: ["t@x.com"] });
  assert.equal(patchContactIn([person], "p", { kindOverride: "company" })[0].isCompany, true);
});
