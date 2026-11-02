// Tests for thread-header.ts: the header title and subtitle, group member names, and the forward body.

import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardDraft, groupMembers, headerOf } from "./thread-header";
import type { Contact, Message, Thread } from "./types";

const people: Record<string, { name: string; emails: string[]; phones: string[]; handles?: string[] }> = {
  c1: { name: "Sarah", emails: ["sarah@x.co"], phones: [] },
  c2: { name: "Tom", emails: [], phones: [], handles: ["tom"] },
  c3: { name: "Lee", emails: [], phones: [] },
};
const byId = (id: string) => people[id] as Contact | undefined;
const thread = (extra: Partial<Thread>) => ({ id: "t", participantIds: ["c1"], channel: "email", ...extra }) as Thread;
const msg = (from: string, extra: Partial<Message> = {}) => ({ id: from, from, sentAt: "2026-01-01T10:00:00Z", body: "hello", ...extra }) as Message;

test("groupMembers joins names with commas and and, and is undefined when nobody is named", () => {
  assert.equal(groupMembers(["c1", "c2", "c3"], [], byId), "Sarah, Tom and Lee");
  assert.equal(groupMembers(["c1"], [], byId), "Sarah");
  assert.equal(groupMembers(["zz"], [], byId), undefined);
});

test("groupMembers includes people who wrote but are not listed, and skips you and unknown senders", () => {
  assert.equal(groupMembers(["c1"], [msg("c2"), msg("me"), msg("unknown")], byId), "Sarah and Tom");
});

test("an email header shows the subject, with the address their latest message came from kept for the link", () => {
  const h = headerOf(thread({ subject: " Quote for May " }), [msg("c1", { address: "old@x.co" }), msg("me"), msg("c1", { address: "new@x.co" })], byId);
  assert.equal(h.subtitle, "Quote for May");
  assert.equal(h.address, "new@x.co");
  assert.equal(h.primary?.name, "Sarah");
});

test("an email with no subject falls back to the address", () => {
  const h = headerOf(thread({}), [msg("c1", { address: "new@x.co" })], byId);
  assert.equal(h.subtitle, "new@x.co");
});

test("an instagram header shows the handle, a group shows its name and members", () => {
  assert.equal(headerOf(thread({ channel: "instagram", participantIds: ["c2"] }), [], byId).subtitle, "@tom");
  const g = headerOf(thread({ isGroup: true, groupName: "team", participantIds: ["c1", "c2"] }), [], byId);
  assert.equal(g.primary, undefined);
  assert.equal(g.subtitle, "Sarah and Tom");
});

test("a forward quotes the latest stored message and does not double the Fwd prefix", () => {
  const fwd = forwardDraft(thread({ subject: "Quote" }), [msg("c1", { body: "first" }), msg("me", { body: "pending", sendState: "sending" })]);
  assert.equal(fwd.subject, "Fwd: Quote");
  assert.ok(fwd.body.includes("Begin forwarded message:") && fwd.body.endsWith("first"));
  assert.equal(forwardDraft(thread({ subject: "Fwd: Quote" }), []).subject, "Fwd: Quote");
});
