// Tests for docs.ts: what each kind of row becomes in the index, what is left out, and that text is cut to size.

import test from "node:test";
import assert from "node:assert/strict";
import type { Contact, Thread } from "../types";
import { bodyOf, clip, contactDoc, eventDoc, messageDocs, noteDoc, taskDoc, threadDoc, type MessageRow, type People } from "./docs";
import { SearchEngine } from "./engine";
import { parseQuery } from "./query";
import { TEXT_CAP } from "./types";

const jane: Contact = { id: "c1", name: "Jane Doe", initials: "JD", hue: 1, emails: ["jane@acme.com"], phones: ["+27821234567"], company: "Acme", role: "Director", isCompany: false };
const people: People = { nameOf: (id) => (id === "c1" ? "Jane Doe" : undefined), peersOf: () => "Jane Doe" };

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "t1", channel: "email", provider: "gmail", subject: "Q3 Figures", participantIds: ["c1"], lastMessageAt: "2026-11-01T10:00:00Z", preview: "Numbers attached",
  unread: true, unreadCount: 1, pinned: false, status: "inbox", priority: "normal", category: "other", summary: "Jane sent the quarterly numbers.", needsReply: false, lastFromMe: false, junk: false, subscription: false, ...over,
} as Thread);

const row = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: "m1", thread_id: "t1", direction: "inbound", sender_contact_id: "c1", sender_address: "jane@acme.com", to_addresses: ["me@x.com"],
  sent_at: "2026-11-01T09:00:00Z", subject: "Q3 Figures", body_text: "Hi, the numbers are attached.", attachments: [], ...over,
});

test("a conversation is titled by the person and found by who is in it", () => {
  const d = threadDoc(thread(), (id) => (id === "c1" ? jane : undefined));
  assert.equal(d.t, "Jane Doe");
  assert.equal(d.u, 1);
  assert.equal(d.tr, undefined);
  assert.ok(d.fr!.includes("jane@acme.com") && d.fr!.includes("+27821234567"));
  assert.ok(d.x.includes("quarterly numbers"));
  assert.equal(d.at, Date.parse("2026-11-01T10:00:00Z"));
});

test("a group is titled by its name and a binned conversation is marked", () => {
  const d = threadDoc(thread({ isGroup: true, groupName: "Book Club", status: "trash", unread: false }), () => undefined);
  assert.equal(d.t, "Book Club");
  assert.equal(d.tr, 1);
  assert.equal(d.u, undefined);
});

test("a contact is found by a local number as well as the stored international one", () => {
  const e = new SearchEngine();
  e.upsert([contactDoc(jane)]);
  assert.equal(e.search(parseQuery("0821234567"), { contact: 5 }).contact.hits.length, 1);
  assert.equal(e.search(parseQuery("director acme"), { contact: 5 }).contact.hits.length, 1);
});

test("a task, a note and an event keep their time and their text", () => {
  const task = taskDoc({ id: "k", accountId: "a", title: "Send invoice", notes: "to Jane", listName: "Clients", dueAt: "2026-11-05T00:00:00Z", dueAllDay: true, completed: true });
  assert.equal(task.d, 1);
  assert.equal(task.at, Date.parse("2026-11-05T00:00:00Z"));
  assert.ok(task.x.includes("Clients"));
  const note = noteDoc({ id: "n", title: "", body: "# Heading\n\nSome **bold** words", updatedAt: "2026-11-01T00:00:00Z" });
  assert.equal(note.t, "Untitled");
  assert.ok(note.x.includes("Some bold words"));
  const event = eventDoc({ id: "e", title: "Review", starts_at: "2026-11-09T08:00:00Z", location: "Boardroom", attendees: [{ name: "Sam", email: "sam@x.com" }, null] });
  assert.ok(event.x.includes("Boardroom") && event.x.includes("sam@x.com"));
});

test("a message has its sender and recipients, and each visible file becomes a file document", () => {
  const docs = messageDocs(row({ attachments: [{ id: "a1", filename: "Report.pdf" }, { id: "a2", filename: "logo.png", hidden: true }] }), people);
  assert.equal(docs.length, 2);
  const [message, file] = docs;
  assert.equal(message.a, 1);
  assert.equal(message.fr, "Jane Doe jane@acme.com");
  assert.equal(message.to, "me@x.com me");
  assert.equal(file.k, "file");
  assert.equal(file.t, "Report.pdf");
  assert.equal(file.mi, "m1");
  assert.equal(file.th, "t1");
});

test("a message you sent is from me, to the people in the conversation", () => {
  const [m] = messageDocs(row({ direction: "outbound", sender_contact_id: null, sender_address: "me@x.com", to_addresses: [] }), people);
  assert.equal(m.me, 1);
  assert.equal(m.fr, "me me@x.com");
  assert.equal(m.to, "Jane Doe");
});

test("email bodies lose their quoted history, WhatsApp text is kept as sent, and a voice note's transcript is searchable", () => {
  const quoted = "Thanks, see you Monday.\n\nOn Mon, 3 Nov 2026 at 09:00, Jane Doe <jane@acme.com> wrote:\n> the secret old line";
  assert.ok(!bodyOf(row({ body_text: quoted })).includes("secret old line"));
  assert.ok(bodyOf(row({ body_text: quoted, provider_meta: { chat: "27821234567@s.whatsapp.net" } })).includes("secret old line"));
  assert.ok(bodyOf(row({ body_text: "", provider_meta: { chat: "x" }, transcript: "call me back" })).includes("call me back"));
});

test("text is tidied and cut to the length for its kind", () => {
  assert.equal(clip("  a \n\n b  ", "message"), "a b");
  assert.equal(clip("x".repeat(5000), "message").length, TEXT_CAP.message);
  assert.equal(clip("x".repeat(5000), "note").length, TEXT_CAP.note);
  assert.equal(clip("anything", "file"), "");
  assert.equal(clip(null, "task"), "");
});
