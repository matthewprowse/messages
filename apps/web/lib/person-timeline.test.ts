// Tests for person-timeline.ts: messages from every channel in date order, linked threads drawn together under a matter,
// and the reply defaulting to the channel of their last message.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, lastIncomingThread, matterTitle, personThreads, replyOptions, threadLabel } from "./person-timeline";
import type { Message, Thread } from "./types";

const t = (id: string, channel: Thread["channel"], lastMessageAt: string, extra: Partial<Thread> = {}) =>
  ({ id, channel, lastMessageAt, participantIds: ["p"], isGroup: false, status: "inbox", ...extra }) as Thread;
const m = (id: string, threadId: string, sentAt: string, from = "p", extra: Partial<Message> = {}) => ({ id, threadId, sentAt, from, body: id, ...extra }) as Message;

const email = t("e", "email", "2026-02-03", { subject: " Roof Quote " });
const wa = t("w", "whatsapp", "2026-02-05");
const li = t("l", "linkedin", "2026-01-01");
const all: Record<string, Message[]> = {
  e: [m("e1", "e", "2026-02-01T09:00:00Z"), m("e2", "e", "2026-02-03T09:00:00Z", "me")],
  w: [m("w1", "w", "2026-02-02T09:00:00Z"), m("w2", "w", "2026-02-05T09:00:00Z")],
  l: [m("l1", "l", "2026-01-01T09:00:00Z")],
};
const of = (id: string) => all[id] ?? [];

test("without links every channel's messages run in date order in one block", () => {
  const blocks = buildTimeline([email, wa, li], of, []);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].entries.map((e) => e.message.id), ["l1", "e1", "w1", "e2", "w2"]);
  assert.deepEqual(blocks[0].entries.map((e) => e.thread.channel), ["linkedin", "email", "whatsapp", "email", "whatsapp"]);
});

test("linked threads sit together in a matter block placed at their first message, titled by the email subject", () => {
  const blocks = buildTimeline([email, wa, li], of, [["e", "w"]]);
  assert.deepEqual(blocks.map((b) => b.kind), ["messages", "matter"]);
  const matter = blocks[1];
  assert.equal(matter.kind === "matter" && matter.title, "Roof Quote");
  assert.deepEqual(matter.entries.map((e) => e.message.id), ["e1", "w1", "e2", "w2"]);
});

test("loose messages after a matter start a new block, and a matter with nothing loaded does not appear", () => {
  const more: Record<string, Message[]> = { ...all, l: [m("l9", "l", "2026-03-01T09:00:00Z")] };
  const blocks = buildTimeline([email, wa, li], (id) => more[id] ?? [], [["e", "w"]]);
  assert.deepEqual(blocks.map((b) => b.kind), ["matter", "messages"]);
  assert.equal(buildTimeline([email, wa], () => [], [["e", "w"]]).length, 0);
});

test("a matter without an email is called Linked Conversations", () => {
  assert.equal(matterTitle([wa, li]), "Linked Conversations");
});

test("a person's threads leave out groups, deleted and others, newest first, and are capped", () => {
  const out = personThreads([li, wa, t("g", "whatsapp", "2026-03-01", { isGroup: true }), t("d", "email", "2026-03-01", { status: "trash" }), t("o", "email", "2026-03-01", { participantIds: ["q"] }), email], "p", 2);
  assert.deepEqual(out.map((x) => x.id), ["w", "e"]);
});

test("the reply goes to the conversation of their last incoming message, ignoring your own and unsent ones", () => {
  assert.equal(lastIncomingThread([email, wa, li], of)?.id, "w");
  const mine: Record<string, Message[]> = { ...all, w: [m("w3", "w", "2026-02-09T09:00:00Z", "me"), m("w4", "w", "2026-02-09T10:00:00Z", "p", { sendState: "queued" })] };
  assert.equal(lastIncomingThread([email, wa, li], (id) => mine[id] ?? [])?.id, "e");
});

test("before anything loads the reply defaults to the newest conversation, and nobody gives undefined", () => {
  assert.equal(lastIncomingThread([email, wa, li], () => [])?.id, "w");
  assert.equal(lastIncomingThread([], of), undefined);
});

test("reply options are the newest conversation per channel in a fixed order, with the preferred thread standing in", () => {
  const older = t("e0", "email", "2026-01-15");
  assert.deepEqual(replyOptions([li, wa, older, email]).map((x) => x.id), ["e", "w", "l"]);
  assert.deepEqual(replyOptions([li, wa, older, email], older).map((x) => x.id), ["e0", "w", "l"]);
});

test("an email is named by its subject (or No Subject) and a chat by its channel", () => {
  assert.equal(threadLabel(email), "Roof Quote");
  assert.equal(threadLabel(t("x", "email", "2026-01-01")), "No Subject");
  assert.equal(threadLabel(wa), "WhatsApp Chat");
});
