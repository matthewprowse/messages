// Tests for waitlist.ts: what a Request Access form may store, and the seats a team request starts with.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRequest, teamSeats } from "./waitlist";

test("an individual request needs only a valid email, stored trimmed and lower case", () => {
  assert.deepEqual(checkRequest({ kind: "individual", email: "  Agent@Example.co.za " }), { ok: true, value: { kind: "individual", email: "agent@example.co.za" } });
  assert.equal(checkRequest({ kind: "individual", email: "not an email" }).ok, false);
});

test("a team request needs a company and a size from the list", () => {
  assert.deepEqual(checkRequest({ kind: "team", email: "p@office.co.za", company: " Sea Point Realty ", teamSize: "11-25" }), { ok: true, value: { kind: "team", email: "p@office.co.za", company: "Sea Point Realty", teamSize: "11-25" } });
  assert.equal(checkRequest({ kind: "team", email: "p@office.co.za", company: "", teamSize: "11-25" }).ok, false);
  assert.equal(checkRequest({ kind: "team", email: "p@office.co.za", company: "Office", teamSize: "12" }).ok, false);
});

test("anything that is not a team or an individual is refused", () => {
  assert.equal(checkRequest(null).ok, false);
  assert.equal(checkRequest({ kind: "admin", email: "a@b.co" }).ok, false);
});

test("a team starts with the top of its size range, and never fewer than 5 seats", () => {
  assert.equal(teamSeats("2-5"), 5);
  assert.equal(teamSeats("11-25"), 25);
  assert.equal(teamSeats(null), 5);
});
