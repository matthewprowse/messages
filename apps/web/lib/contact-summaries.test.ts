// Tests for building the Contacts list from the store's contacts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { summariseStored } from "./contact-summaries";
import type { Contact } from "./types";

const ann: Contact = { id: "1", name: "Ann", initials: "A", hue: 0, emails: ["a@x.com"], phones: ["+27111", "+27111"], isCompany: false, organization: { id: "o", name: "Acme" }, company: "Old Co", role: "CEO", avatarPath: "p.png" };

test("a list row is built from the stored contact plus the small queries", () => {
  const rows = summariseStored([{ id: "1", hidden: true }], new Map([["1", ann]]), new Map([["1", { contact_id: "1", last_at: "2026-01-01", conversation_count: 4 }]]), new Set(["1"]));
  assert.deepEqual(rows, [{
    id: "1", name: "Ann", company: "Acme", role: "CEO", hidden: true, emails: ["a@x.com"], phones: ["+27111"], hasWhatsApp: true,
    lastAt: "2026-01-01", avatarPath: "p.png", isCompany: false, organizationName: "Acme", conversationCount: 4, handles: [], hasLinkedIn: false, kindOverride: undefined,
  }]);
});

test("Instagram handles, LinkedIn and the person or company override reach the row", () => {
  const who: Contact = { ...ann, handles: ["ann.m"], kindOverride: "company" };
  const [row] = summariseStored([{ id: "1", hidden: false }], new Map([["1", who]]), new Map(), new Set(), new Set(["1"]))!;
  assert.deepEqual([row.handles, row.hasLinkedIn, row.kindOverride], [["ann.m"], true, "company"]);
});

test("a contact with no activity sorts last and the company falls back to the stored one", () => {
  const [row] = summariseStored([{ id: "2", hidden: false }], new Map([["2", { ...ann, id: "2", organization: undefined }]]), new Map(), new Set())!;
  assert.equal(row.lastAt, null);
  assert.equal(row.conversationCount, 0);
  assert.equal(row.company, "Old Co");
  assert.equal(row.organizationName, null);
});

test("a contact the store lacks makes the caller read everything", () => {
  assert.equal(summariseStored([{ id: "9", hidden: false }], new Map(), new Map(), new Set()), null);
});
