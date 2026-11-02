// Tests for template-vars.ts: variables are filled from the contact and your name, and left visible when unknown.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fillVariables, firstNameOf, unresolvedVariables, varsFor } from "./template-vars";

test("firstNameOf ignores addresses and numbers", () => {
  assert.equal(firstNameOf("Jane van der Merwe"), "Jane");
  assert.equal(firstNameOf("jane@x.com"), "");
  assert.equal(firstNameOf("+27 82 123 4567"), "");
});

test("varsFor takes the company from the contact, else their organisation", () => {
  assert.equal(varsFor({ name: "Jane Doe", company: "Acme" }, "Matt").company, "Acme");
  assert.equal(varsFor({ name: "Jane Doe", organization: { name: "Globex" } }, "Matt").company, "Globex");
  assert.deepEqual(varsFor(undefined, " Matt "), { first_name: "", name: "", company: "", my_name: "Matt" });
});

test("fillVariables fills every use and leaves unknown ones as typed", () => {
  const vars = varsFor({ name: "Jane Doe" }, "Matt Prowse");
  assert.equal(fillVariables("Hi {first_name}, {first_name}! Regards {my_name} ({company}) {other}", vars), "Hi Jane, Jane! Regards Matt Prowse ({company}) {other}");
  assert.equal(fillVariables("Dear {name}", vars), "Dear Jane Doe");
});

test("unresolvedVariables lists each left-over variable once", () => {
  assert.deepEqual(unresolvedVariables("Hi {first_name}, {company} and {company}, {unknown}"), ["{first_name}", "{company}"]);
  assert.deepEqual(unresolvedVariables("No variables"), []);
});
