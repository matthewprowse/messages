// Tests for lib/tidy-up.ts: what counts towards the Tidy Up card and how it reads.

import test from "node:test";
import assert from "node:assert/strict";
import { tidyCounts, unnamedContacts } from "./tidy-up";

const c = (name: string, over: Record<string, unknown> = {}) => ({ name, hidden: false, isCompany: false, ...over });

test("only listed people whose name is a number or an address need a name", () => {
  const list = [c("Sam Jones"), c("+27 82 123 4567"), c("sam@firm.co.za"), c("0821234567", { hidden: true }), c("27821234568", { isCompany: true })];
  assert.deepEqual(unnamedContacts(list).map((x) => x.name), ["+27 82 123 4567", "sam@firm.co.za"]);
});

test("the card adds pending merges and unnamed contacts, and says each", () => {
  const list = [c("Sam"), c("sam@firm.co.za"), c("+27821234567")];
  assert.deepEqual(tidyCounts(list, 3), { total: 5, more: false, unnamed: 2, pairs: 3, detail: "3 possible duplicates and 2 contacts without a name" });
  assert.equal(tidyCounts(list, 0).detail, "2 contacts without a name");
  assert.equal(tidyCounts([c("Sam")], 1).detail, "1 possible duplicate");
  assert.equal(tidyCounts([c("Sam")], 0).total, 0);
});
