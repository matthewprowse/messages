// Tests for linkedin/mapping.ts: helper conversations become ingest_linkedin payloads (sealed and indexed),
// with the rules for groups, skipped conversations, deleted messages, files and unread.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field } from "@messages/crypto/fields";
import type { LinkedInConversation, LinkedInMessage, LinkedInPerson } from "./helper";
import { DELETED_TEXT, attachmentRows, ingestPayload, isGroup, messageText, personName, personNameRank, seenByOther, skipConversation, stubConversation, unreadUrns, type Sealer } from "./mapping";

// Hand-written data in the shape the helper reports. Names are made up.

const me: LinkedInPerson = { id: "ACoAAME", urn: "urn:li:fsd_profile:ACoAAME", kind: "member", firstName: "Test", lastName: "Owner" };
const sam: LinkedInPerson = { id: "ACoAASAM", urn: "urn:li:fsd_profile:ACoAASAM", kind: "member", firstName: "Sam", lastName: "Example" };
const alex: LinkedInPerson = { id: "ACoAAALEX", urn: "urn:li:fsd_profile:ACoAAALEX", kind: "member", firstName: "Alex", lastName: "Sample" };
const company: LinkedInPerson = { id: "123", urn: "urn:li:fsd_company:123", kind: "organization", name: "Example Co" };

const CONV = "urn:li:msg_conversation:(urn:li:fsd_profile:ACoAAME,2-Q29udg==)";

function conversation(over: Partial<LinkedInConversation> = {}): LinkedInConversation {
  return { urn: CONV, group: false, read: true, lastActivityAt: 3000, lastReadAt: 1500, categories: ["INBOX"], participants: [me, sam], ...over };
}

function message(over: Partial<LinkedInMessage> = {}): LinkedInMessage {
  return { urn: "urn:li:msg_message:(urn:li:fsd_profile:ACoAAME,2-TXNn)", conversationUrn: CONV, sender: sam, deliveredAt: 2000, text: "Is Thursday still good?", format: "DEFAULT", ...over };
}

// Marks what was sealed and indexed, so a test can see each value went through the right door.
const sealer: Sealer = {
  text: async (field: Field, value) => (value === null ? null : `sealed[${field}]:${value}`),
  address: async (value) => (value === null ? null : `addr:${value}`),
  addressIndex: async (value) => `idx:${value}`,
  chatIndex: async (value) => `chat:${value}`,
  groupIndex: async (value) => `group:${value}`,
};

test("names: first and last for a member, the name for a page, a placeholder for neither", () => {
  assert.equal(personName(sam), "Sam Example");
  assert.equal(personName(company), "Example Co");
  assert.equal(personName({ id: "x", urn: "urn:li:fsd_profile:x", kind: "member" }), "LinkedIn Member");
  // The stand-in is ranked below a real name, so the database replaces it when the name arrives (it cannot read either).
  assert.equal(personNameRank(sam), 2);
  assert.equal(personNameRank({ id: "x", urn: "urn:li:fsd_profile:x", kind: "member" }), 0);
});

test("spam and conversations you have left are not stored", () => {
  assert.equal(skipConversation(conversation(), me.id), false);
  assert.equal(skipConversation(conversation({ categories: ["SPAM"] }), me.id), true);
  assert.equal(skipConversation(conversation({ participants: [sam, alex] }), me.id), true);
});

test("a conversation with more than one other person is a group", () => {
  assert.equal(isGroup(conversation(), me.id), false);
  assert.equal(isGroup(conversation({ participants: [me, sam, alex] }), me.id), true);
  assert.equal(isGroup(conversation({ group: true }), me.id), true);
});

test("an inbound message becomes ingest_linkedin's payload, sealed and indexed", async () => {
  const payload = await ingestPayload(message(), conversation(), me.id, sealer, { live: true, unread: true });
  assert.ok(payload);
  assert.equal(payload.provider_message_id, "urn:li:msg_message:(urn:li:fsd_profile:ACoAAME,2-TXNn)");
  assert.equal(payload.chat_id, `addr:${CONV}`);
  assert.equal(payload.chat_index, `chat:${CONV}`);
  assert.equal(payload.direction, "inbound");
  assert.equal(payload.is_group, false);
  assert.equal(payload.group_name, null);
  assert.equal(payload.status, "inbox");
  assert.equal(payload.resurface, true);
  assert.equal(payload.is_read, false);
  assert.equal(payload.sent_at, new Date(2000).toISOString());
  assert.deepEqual(payload.sender, { urn: "addr:urn:li:fsd_profile:ACoAASAM", urn_index: "idx:urn:li:fsd_profile:ACoAASAM", display_name: "sealed[name]:Sam Example", name_rank: 2 });
  assert.equal(payload.sender_address, "addr:urn:li:fsd_profile:ACoAASAM");
  assert.equal(payload.sender_index, "idx:urn:li:fsd_profile:ACoAASAM");
  assert.deepEqual(payload.participants, [payload.sender], "everyone but you");
  assert.equal(payload.body_text, "sealed[body]:Is Thursday still good?");
  assert.equal(payload.preview, "sealed[preview]:Is Thursday still good?");
  assert.deepEqual(payload.provider_meta, { chat: `addr:${CONV}`, from_me: false, type: "default", receipt: "pending" });
  assert.deepEqual(payload.attachments, []);
});

test("your own message is outbound and read, with no sender", async () => {
  const payload = await ingestPayload(message({ sender: me }), conversation(), me.id, sealer, { live: true, unread: true });
  assert.ok(payload);
  assert.equal(payload.direction, "outbound");
  assert.equal(payload.is_read, true);
  assert.equal(payload.resurface, false);
  assert.equal(payload.sender, null);
  assert.equal(payload.sender_address, null);
  assert.equal(payload.provider_meta.receipt, undefined);
});

test("a group names who said it in the preview and keeps its title", async () => {
  const conv = conversation({ group: true, title: "Deal Team", participants: [me, sam, alex] });
  const payload = await ingestPayload(message(), conv, me.id, sealer, { live: true, unread: false });
  assert.ok(payload);
  assert.equal(payload.is_group, true);
  assert.equal(payload.group_name, "sealed[name]:Deal Team");
  assert.equal(payload.group_name_index, "group:Deal Team");
  assert.equal(payload.preview, "sealed[preview]:Sam Example: Is Thursday still good?");
  assert.equal(payload.participants.length, 2);
});

test("the first import keeps archived conversations archived; live messages bring them back", async () => {
  const conv = conversation({ categories: ["ARCHIVE"] });
  assert.equal((await ingestPayload(message(), conv, me.id, sealer, { live: false, unread: false }))?.status, "archived");
  assert.equal((await ingestPayload(message(), conv, me.id, sealer, { live: false, unread: false }))?.resurface, false);
  assert.equal((await ingestPayload(message(), conv, me.id, sealer, { live: true, unread: false }))?.status, "inbox");
});

test("files become attachment rows; a message of only a file is previewed by its name", async () => {
  const files = [
    { name: "Offer.pdf", mediaType: "application/pdf", size: 2048 },
    { name: "Photo.jpg", mediaType: "image/jpeg" },
    { name: "", mediaType: "" },
  ];
  assert.deepEqual(attachmentRows(files), [
    { filename: "Offer.pdf", mime_type: "application/pdf", kind: "pdf", size_bytes: 2048 },
    { filename: "Photo.jpg", mime_type: "image/jpeg", kind: "image", size_bytes: null },
    { filename: "File", mime_type: "application/octet-stream", kind: "file", size_bytes: null },
  ]);
  const payload = await ingestPayload(message({ text: "", files: files.slice(0, 1) }), conversation(), me.id, sealer, { live: true, unread: false });
  assert.ok(payload);
  assert.equal(payload.preview, "sealed[preview]:Attachment: Offer.pdf");
  assert.equal(payload.body_text, null);
});

test("deleted messages say so; LinkedIn's notices and empty messages are not stored", async () => {
  assert.deepEqual(messageText(message({ format: "RECALLED", text: "secret" })), { text: DELETED_TEXT, deleted: true });
  assert.equal(messageText(message({ format: "SYSTEM" })), null);
  assert.equal(messageText(message({ text: "  " })), null);
  const deleted = await ingestPayload(message({ format: "RECALLED", files: [{ name: "a.pdf", mediaType: "application/pdf" }] }), conversation(), me.id, sealer, { live: true, unread: false });
  assert.ok(deleted);
  assert.equal(deleted.body_text, `sealed[body]:${DELETED_TEXT}`);
  assert.equal(deleted.provider_meta.deleted, true);
  assert.deepEqual(deleted.attachments, []);
  assert.equal(await ingestPayload(message({ format: "SYSTEM" }), conversation(), me.id, sealer, { live: true, unread: false }), null);
});

test("unread: messages from others after you last read it, only when LinkedIn says it is unread", () => {
  const msgs = [
    message({ urn: "a", deliveredAt: 1000 }),
    message({ urn: "b", deliveredAt: 2000 }),
    message({ urn: "c", deliveredAt: 2500, sender: me }),
    message({ urn: "d", deliveredAt: 2600 }),
  ];
  assert.deepEqual([...unreadUrns(conversation({ read: false, lastReadAt: 1500 }), msgs, me.id)], ["b", "d"]);
  assert.deepEqual([...unreadUrns(conversation({ read: true }), msgs, me.id)], []);
  assert.deepEqual([...unreadUrns(conversation({ read: false, lastReadAt: undefined }), msgs, me.id)], ["a", "b", "d"]);
});

test("a message in a conversation not known yet is stored with just you and its sender", async () => {
  const stub = stubConversation(message(), me);
  assert.equal(stub.urn, CONV);
  assert.deepEqual(stub.participants, [me, sam]);
  const payload = await ingestPayload(message(), stub, me.id, sealer, { live: true, unread: true });
  assert.ok(payload);
  assert.equal(payload.participants.length, 1);
});

test("seen: only the other person in a one-to-one conversation, never you or a group", () => {
  const direct = conversation();
  assert.equal(seenByOther(direct, sam.id, 5000, me.id), 5000);
  assert.equal(seenByOther(direct, me.id, 5000, me.id), null); // you, on another device
  assert.equal(seenByOther(direct, alex.id, 5000, me.id), null); // not in it
  assert.equal(seenByOther(direct, sam.id, 0, me.id), null);
  assert.equal(seenByOther(undefined, sam.id, 5000, me.id), null);
  assert.equal(seenByOther(conversation({ group: true, participants: [me, sam, alex] }), sam.id, 5000, me.id), null);
});
