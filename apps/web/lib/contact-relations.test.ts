// Tests for lib/contact-relations.ts: joining the star, relationship and last-touch reads onto list rows.

import test from "node:test";
import assert from "node:assert/strict";
import type { ContactSummary } from "./contacts";
import { applyRelations, joinRelations, NO_RELATION } from "./contact-relations";

const row = (id: string): ContactSummary => ({
  id, name: id, company: null, role: null, emails: [], phones: [], lastAt: null, isCompany: false, organizationName: null,
  conversationCount: 0, hasWhatsApp: false, handles: [], hasLinkedIn: false, hidden: false,
});

test("flags and last touches join by contact, and a touch alone still makes a relation", () => {
  const joined = joinRelations(
    [{ id: "a", vip: true, relationship: " Client " }, { id: "b", vip: false, relationship: "" }],
    [{ contact_id: "a", last_inbound_at: "2026-11-01T00:00:00Z", last_outbound_at: null }, { contact_id: "c", last_inbound_at: null, last_outbound_at: "2026-10-01T00:00:00Z" }],
  );
  assert.deepEqual(joined.get("a"), { vip: true, relationship: "Client", lastInboundAt: "2026-11-01T00:00:00Z", lastOutboundAt: null });
  assert.deepEqual(joined.get("b"), NO_RELATION);
  assert.deepEqual(joined.get("c"), { ...NO_RELATION, lastOutboundAt: "2026-10-01T00:00:00Z" });
});

test("every row gets the fields, empty when nothing is recorded", () => {
  const rows = applyRelations([row("a"), row("z")], new Map([["a", { vip: true, relationship: "Client", lastInboundAt: null, lastOutboundAt: null }]]));
  assert.equal(rows[0].vip, true);
  assert.equal(rows[0].relationship, "Client");
  assert.equal(rows[1].vip, false);
  assert.equal(rows[1].relationship, null);
});
