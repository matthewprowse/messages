// Tests for person-groups-href.ts: group=person is appended to list addresses only when By Person is on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { withGroup } from "./person-groups-href";

test("By Person adds group=person with the right separator, and off leaves the address alone", () => {
  assert.equal(withGroup("/inbox", true), "/inbox?group=person");
  assert.equal(withGroup("/inbox?view=priority", true), "/inbox?view=priority&group=person");
  assert.equal(withGroup("/inbox?view=priority", false), "/inbox?view=priority");
});
