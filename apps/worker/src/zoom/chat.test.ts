import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "@messages/db";
import { ZoomApiError, type ZoomApi, type ZoomRequest } from "./client";
import { ChatSync, chatPayload, chatRef, messageText, sendBody, zoomTime, type ZoomChatMessage, type ZoomChatSession } from "./chat";

// Team Chat mapping and polling on hand-written replies shaped like Zoom's (GET /chat/users/me/sessions and
// GET /chat/users/me/messages). Nothing here talks to Zoom.

const sealer = {
  seal: async (field: string, value: string | null) => (value == null ? null : `sealed:${field}:${value}`),
  sealAddress: async (value: string | null) => (value == null ? null : `addr:${value}`),
  addressIndex: async (value: string) => `idx:${value}`,
  chatIndex: async (value: string) => `chat:${value}`,
};
const ctx = { selfEmail: "Thandi@konva.co.za" };

const oneToOne: ZoomChatSession = { type: "1:1", name: "Pieter van Wyk", peer_contact_email: "Pieter@Example.co.za", peer_contact_user_id: "p-1", last_message_sent_time: "2026-10-26T09:59:00Z" };
const group: ZoomChatSession = { type: "groupchat", name: "Transfers Team", channel_id: "ch-42", last_message_sent_time: "2026-10-26T09:58:00Z" };

test("keys a 1:1 chat by the other person's email and a group by its channel", () => {
  assert.deepEqual(chatRef(oneToOne), { id: "pieter@example.co.za", isGroup: false, name: "Pieter van Wyk", peerEmail: "pieter@example.co.za" });
  assert.deepEqual(chatRef(group), { id: "ch-42", isGroup: true, name: "Transfers Team", peerEmail: null });
  assert.deepEqual(chatRef({ type: "1:1", name: "Guest", peer_contact_member_id: "m-9" }), { id: "m-9", isGroup: false, name: "Guest", peerEmail: null });
  assert.equal(chatRef({ type: "groupchat", name: "No ID" }), null);
});

test("maps an incoming 1:1 message, matched to its sender by email", async () => {
  const message: ZoomChatMessage = { id: "msg-1", message: "Can we move the  transfer\nto Friday?", sender: "pieter@example.co.za", sender_display_name: "Pieter van Wyk", date_time: "2026-10-26T09:59:00Z", timestamp: 1_793_008_740_000 };
  const payload = (await chatPayload(message, chatRef(oneToOne)!, ctx, sealer, true)) as Record<string, Json>;
  assert.deepEqual(payload, {
    provider_message_id: "msg-1",
    chat_id: "addr:pieter@example.co.za",
    chat_index: "chat:pieter@example.co.za",
    is_group: false,
    group_name: null,
    resurface: true,
    sent_at: new Date(1_793_008_740_000).toISOString(),
    direction: "inbound",
    is_read: false,
    sender: { address: "addr:pieter@example.co.za", index: "idx:pieter@example.co.za", display_name: "Pieter van Wyk" },
    sender_address: "addr:pieter@example.co.za",
    sender_index: "idx:pieter@example.co.za",
    participants: [{ address: "addr:pieter@example.co.za", index: "idx:pieter@example.co.za", display_name: "Pieter van Wyk" }],
    preview: "sealed:preview:Can we move the transfer to Friday?",
    body_text: "sealed:body:Can we move the  transfer\nto Friday?",
    provider_meta: { chat: "addr:pieter@example.co.za", from_me: false },
  });
});

test("maps your own message as outbound and read, with no sender", async () => {
  const message: ZoomChatMessage = { id: "msg-2", message: "Sure", sender: "thandi@konva.co.za", sender_display_name: "Thandi Nkosi", timestamp: 1_793_008_800_000, reply_main_message_id: "msg-1" };
  const payload = (await chatPayload(message, chatRef(oneToOne)!, ctx, sealer, true)) as Record<string, Json>;
  assert.equal(payload.direction, "outbound");
  assert.equal(payload.is_read, true);
  assert.equal(payload.resurface, false);
  assert.equal(payload.sender, null);
  assert.equal(payload.sender_address, null);
  assert.equal(payload.sender_index, null);
  assert.deepEqual(payload.provider_meta, { chat: "addr:pieter@example.co.za", from_me: true, reply_main: "msg-1" });
});

test("names the sender in a group's preview, and keeps no participants but the sender", async () => {
  const message: ZoomChatMessage = { id: "msg-3", message: "Bond approved", sender: "lindiwe@bank.co.za", sender_display_name: "Lindiwe Dube", date_time: "2026-10-26T09:58:00Z" };
  const payload = (await chatPayload(message, chatRef(group)!, ctx, sealer, false)) as Record<string, Json>;
  assert.equal(payload.is_group, true);
  assert.equal(payload.group_name, "Transfers Team");
  assert.equal(payload.chat_index, "chat:ch-42");
  assert.equal(payload.preview, "sealed:preview:Lindiwe Dube: Bond approved");
  assert.equal(payload.is_read, true); // history arrives read
  assert.deepEqual(payload.participants, []);
  assert.deepEqual(payload.sender, { address: "addr:lindiwe@bank.co.za", index: "idx:lindiwe@bank.co.za", display_name: "Lindiwe Dube" });
});

test("lists a message's files by name, and skips one with nothing to show", async () => {
  assert.equal(messageText({ id: "f", message: "", files: [{ file_name: "OTP.pdf" }, { file_name: "ID copy.jpg" }] }), "File: OTP.pdf\nFile: ID copy.jpg");
  assert.equal(messageText({ id: "f", message: "Signed", file_name: "OTP.pdf" }), "Signed\nFile: OTP.pdf");
  assert.equal(await chatPayload({ id: "card", message: "", bot_message: {} }, chatRef(group)!, ctx, sealer, true), null);
});

test("sends to the chat's contact or channel, as a thread reply when it answers one", () => {
  assert.deepEqual(sendBody({ id: "pieter@example.co.za", isGroup: false }, "Yes", null), { message: "Yes", to_contact: "pieter@example.co.za" });
  assert.deepEqual(sendBody({ id: "ch-42", isGroup: true }, "Noted", "msg-3"), { message: "Noted", to_channel: "ch-42", reply_main_message_id: "msg-3" });
});

class FakeZoom implements ZoomApi {
  calls: { path: string; query: Record<string, unknown> }[] = [];
  constructor(private readonly reply: (path: string, query: Record<string, unknown>) => unknown) {}
  async request<T>(path: string, init: ZoomRequest = {}): Promise<T> {
    const query = (init.query ?? {}) as Record<string, unknown>;
    this.calls.push({ path, query });
    const out = this.reply(path, query);
    if (out instanceof Error) throw out;
    return out as T;
  }
  async download(): Promise<Buffer> {
    throw new Error("not used");
  }
}

test("polls the chats active since the last poll and stores their messages oldest first", async () => {
  const since = new Date("2026-10-26T09:50:00Z");
  const until = new Date("2026-10-26T10:00:00Z");
  const quiet: ZoomChatSession = { type: "1:1", name: "Old Chat", peer_contact_email: "old@example.com", last_message_sent_time: "2026-10-01T08:00:00Z" };
  const zoom = new FakeZoom((path, q) => {
    if (path === "/chat/users/me/sessions") return { sessions: [oneToOne, group, quiet], next_page_token: "" };
    if (q.to_contact === "pieter@example.co.za") {
      // Newest first, over two pages, as Zoom pages them.
      return q.next_page_token
        ? { messages: [{ id: "a", message: "first", sender: "pieter@example.co.za", timestamp: Date.parse("2026-10-26T09:51:00Z") }], next_page_token: "" }
        : { messages: [{ id: "b", message: "second", sender: "thandi@konva.co.za", timestamp: Date.parse("2026-10-26T09:52:00Z") }], next_page_token: "t2" };
    }
    if (q.to_channel === "ch-42") return new ZoomApiError(404, 4130); // left the channel since
    throw new Error(`unexpected ${path}`);
  });
  const stored: Record<string, Json>[] = [];
  const store = { ingest: async (payload: Json) => { stored.push(payload as Record<string, Json>); return { result: "inserted" as const }; } };

  const inserted = await new ChatSync(zoom, store, sealer, ctx).sync(since, until, true);
  assert.equal(inserted, 2);
  assert.deepEqual(stored.map((p) => p.provider_message_id), ["a", "b"]);
  assert.deepEqual(stored.map((p) => p.direction), ["inbound", "outbound"]);

  const sessions = zoom.calls.find((c) => c.path === "/chat/users/me/sessions")!;
  assert.equal(sessions.query.from, "2026-10-26T09:48:00Z"); // two minutes of overlap
  assert.equal(sessions.query.to, "2026-10-26T10:00:00Z");
  const asked = zoom.calls.filter((c) => c.path === "/chat/users/me/messages").map((c) => c.query.to_contact ?? c.query.to_channel);
  assert.deepEqual(asked, ["pieter@example.co.za", "pieter@example.co.za", "ch-42"]); // not the quiet chat
});

test("a rate limit stops the chat poll", async () => {
  const zoom = new FakeZoom((path) => (path === "/chat/users/me/sessions" ? { sessions: [oneToOne] } : new ZoomApiError(429, null, 1000)));
  const store = { ingest: async () => ({ result: "inserted" as const }) };
  await assert.rejects(new ChatSync(zoom, store, sealer, ctx).sync(new Date(0), new Date(), true), (err: unknown) => err instanceof ZoomApiError && err.status === 429);
});

test("writes times as Zoom's chat APIs take them", () => {
  assert.equal(zoomTime(new Date("2026-10-26T09:48:00.123Z")), "2026-10-26T09:48:00Z");
});
