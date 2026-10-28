// Tests for google/chat.ts: which Chat spaces are read, how Chat messages map to stored messages (direction, previews, quotes,
// deleted ones), the request to send a reply, and the plain-language classification of read and send failures.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_APP_MISSING,
  CHAT_NOT_GRANTED,
  CHAT_OFF,
  buildChatSend,
  chatBody,
  chatReadProblem,
  chatSendFailure,
  chatUserId,
  mapChatMessage,
  messagesFilter,
  spacesToRead,
  type ChatMessage,
  type ChatSpace,
} from "./chat";

// Shaped like the Chat API's responses (spaces.list, spaces.messages.list) when signed in as a user.
const dm: ChatSpace = { name: "spaces/DM111", spaceType: "DIRECT_MESSAGE", lastActiveTime: "2026-10-20T10:00:00Z" };
const group: ChatSpace = { name: "spaces/GC222", spaceType: "GROUP_CHAT", lastActiveTime: "2026-10-20T10:00:00Z" };
const named: ChatSpace = { name: "spaces/SP333", spaceType: "SPACE", displayName: " Sales Team ", lastActiveTime: "2026-10-20T08:00:00Z" };
const bot: ChatSpace = { name: "spaces/BOT", spaceType: "DIRECT_MESSAGE", singleUserBotDm: true, lastActiveTime: "2026-10-20T10:00:00Z" };

const inbound: ChatMessage = {
  name: "spaces/DM111/messages/m1",
  sender: { name: "users/222", type: "HUMAN", displayName: "Pieter van Wyk" },
  createTime: "2026-10-20T09:59:00.123456Z",
  text: "Can we move the transfer to Friday?",
  thread: { name: "spaces/DM111/threads/t1" },
};

test("only spaces with something new are read, and never direct messages with apps", () => {
  assert.deepEqual(spacesToRead([dm, group, named, bot], "2026-10-20T09:00:00Z").map((s) => s.name), ["spaces/DM111", "spaces/GC222"]);
  assert.deepEqual(spacesToRead([dm, named, bot], null).map((s) => s.name), ["spaces/DM111", "spaces/SP333"]);
  // A space that does not say when it was last active is read to be safe.
  assert.equal(spacesToRead([{ name: "spaces/X", spaceType: "GROUP_CHAT" }], "2026-10-20T09:00:00Z").length, 1);
});

test("a direct message from someone else maps to an inbound message without a group name", () => {
  assert.deepEqual(mapChatMessage(inbound, { space: dm, selfUserId: "111" }), {
    providerMessageId: "spaces/DM111/messages/m1",
    space: "spaces/DM111",
    isGroup: false,
    groupName: null,
    sentAt: "2026-10-20T09:59:00.123Z",
    fromMe: false,
    senderUser: "users/222",
    senderName: "Pieter van Wyk",
    body: "Can we move the transfer to Friday?",
    preview: "Can we move the transfer to Friday?",
    thread: null,
    quoted: null,
  });
});

test("your own messages are outbound, by your Google ID or because you just sent them", () => {
  const mine = { ...inbound, sender: { name: "users/111", type: "HUMAN" as const } };
  const mapped = mapChatMessage(mine, { space: dm, selfUserId: "111" })!;
  assert.equal(mapped.fromMe, true);
  assert.equal(mapped.senderName, null);
  // Chat's answer to a send may leave the sender out.
  const sent = mapChatMessage({ ...inbound, sender: undefined }, { space: dm, selfUserId: null, sentByMe: true })!;
  assert.equal(sent.fromMe, true);
  assert.equal(mapChatMessage({ ...inbound, sender: undefined }, { space: dm, selfUserId: "111" }), null);
});

test("in a group the preview says who wrote, and a named space keeps its name and threads", () => {
  const inGroup = mapChatMessage({ ...inbound, name: "spaces/GC222/messages/m2" }, { space: group, selfUserId: "111", senderName: "Pieter (Contacts)" })!;
  assert.equal(inGroup.isGroup, true);
  assert.equal(inGroup.groupName, null);
  assert.equal(inGroup.senderName, "Pieter (Contacts)");
  assert.equal(inGroup.preview, "Pieter (Contacts): Can we move the transfer to Friday?");

  const inSpace = mapChatMessage({ ...inbound, name: "spaces/SP333/messages/m3", thread: { name: "spaces/SP333/threads/t9" } }, { space: named, selfUserId: "111" })!;
  assert.equal(inSpace.groupName, "Sales Team");
  assert.equal(inSpace.thread, "spaces/SP333/threads/t9");
});

test("deleted and empty messages are not stored; files alone are described", () => {
  assert.equal(mapChatMessage({ ...inbound, deleteTime: "2026-10-20T10:00:00Z" }, { space: dm, selfUserId: "111" }), null);
  assert.equal(mapChatMessage({ ...inbound, text: "  " }, { space: dm, selfUserId: "111" }), null);
  assert.equal(chatBody({ attachment: [{ contentName: "OTP.pdf", contentType: "application/pdf" }] }), "Sent a file: OTP.pdf");
  assert.equal(chatBody({ attachment: [{ contentName: "a.jpg" }, { contentName: "b.jpg" }] }), "Sent 2 files");
  assert.equal(chatBody({ text: " Hi ", attachment: [{ contentName: "a.jpg" }] }), "Hi");
});

test("long previews are cut to one line", () => {
  const mapped = mapChatMessage({ ...inbound, text: "line one\nline two " + "x".repeat(300) }, { space: dm, selfUserId: "111" })!;
  assert.ok(!mapped.preview.includes("\n"));
  assert.equal(mapped.preview.length, 160);
  assert.ok(mapped.body.includes("\n"));
});

test("a quoted reply keeps what it quotes", () => {
  const mapped = mapChatMessage({ ...inbound, quotedMessageMetadata: { name: "spaces/DM111/messages/m0" } }, { space: dm, selfUserId: "111" })!;
  assert.equal(mapped.quoted, "spaces/DM111/messages/m0");
});

test("new messages are asked for by create time", () => {
  assert.equal(messagesFilter("2026-10-20T09:00:00.000Z"), 'createTime > "2026-10-20T09:00:00.000Z"');
  assert.equal(chatUserId("users/12345"), "12345");
  assert.equal(chatUserId(undefined), null);
});

test("a reply is posted with the outbox id as its request id, in its thread when there is one", () => {
  assert.deepEqual(buildChatSend({ space: "spaces/DM111", text: "Friday works.", requestId: "row-1" }), {
    url: "https://chat.googleapis.com/v1/spaces/DM111/messages",
    query: { requestId: "row-1" },
    body: { text: "Friday works." },
  });
  assert.deepEqual(buildChatSend({ space: "spaces/SP333", text: "On it.", requestId: "row-2", thread: "spaces/SP333/threads/t9" }), {
    url: "https://chat.googleapis.com/v1/spaces/SP333/messages",
    query: { requestId: "row-2", messageReplyOption: "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" },
    body: { text: "On it.", thread: { name: "spaces/SP333/threads/t9" } },
  });
});

test("refusals to read Chat that need setting up are told apart", () => {
  assert.equal(chatReadProblem(404, "NOT_FOUND"), CHAT_APP_MISSING);
  assert.equal(chatReadProblem(403, "PERMISSION_DENIED"), CHAT_OFF);
  assert.equal(chatReadProblem(403, "insufficientPermissions"), CHAT_NOT_GRANTED);
  assert.equal(chatReadProblem(500, null), null);
  assert.equal(chatReadProblem(429, "RESOURCE_EXHAUSTED"), null);
});

test("a failed send says whether it may have gone out", () => {
  assert.match(chatSendFailure(null, null), /may not have been sent/);
  assert.match(chatSendFailure(503, null), /may not have been sent/);
  assert.match(chatSendFailure(429, null), /busy/);
  assert.match(chatSendFailure(403, "PERMISSION_DENIED"), /cannot post/);
  assert.match(chatSendFailure(404, "NOT_FOUND"), /no longer exists/);
  assert.match(chatSendFailure(400, "INVALID_ARGUMENT"), /did not accept/);
});
