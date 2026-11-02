// Tests for lib/relationships.ts: spelling, the custom values and the list filter.

import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRelationship, isClient, isStandardRelationship, matchesRelationship, relationshipOptions } from "./relationships";

test("a typed value in any case takes the spelling of the set, and a custom one stays as typed", () => {
  assert.equal(canonicalRelationship("  client "), "Client");
  assert.equal(canonicalRelationship("Golf Buddy"), "Golf Buddy");
  assert.equal(canonicalRelationship(null), "");
  assert.equal(isStandardRelationship("SUPPLIER"), true);
  assert.equal(isStandardRelationship("Family"), false);
  assert.equal(isStandardRelationship(""), false);
});

test("only Client counts as a client", () => {
  assert.equal(isClient("client"), true);
  assert.equal(isClient("Prospect"), false);
  assert.equal(isClient(undefined), false);
});

test("the filter lists the set and then each custom value once", () => {
  const options = relationshipOptions([{ relationship: "Family" }, { relationship: "family" }, { relationship: "client" }, { relationship: null }, { relationship: "Alumni" }]);
  assert.deepEqual(options, ["Client", "Prospect", "Colleague", "Supplier", "Personal", "Other", "Alumni", "Family"]);
});

test("a contact passes the filter when the relationship matches in any case, and everyone passes All", () => {
  assert.equal(matchesRelationship({ relationship: "client" }, "Client"), true);
  assert.equal(matchesRelationship({ relationship: "Prospect" }, "Client"), false);
  assert.equal(matchesRelationship({ relationship: null }, "Client"), false);
  assert.equal(matchesRelationship({ relationship: null }, "all"), true);
});
