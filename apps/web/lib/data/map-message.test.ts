// Tests for map-message.ts: WhatsApp extras, attachments, email marks, and patching a held message from Realtime.

import assert from "node:assert/strict";
import { test } from "node:test";
import { emailMarks, mapAttachment, patchMessage, transcriptFlags, whatsappExtras } from "./map-message";
import type { Message } from "../types";

test("whatsapp extras keep a quote with text, drop an empty one, and only known receipts", () => {
  const x = whatsappExtras({ quoted: { id: "q", text: "hi", from_me: true }, reactions: { a: "x" }, receipt: "read", deleted: true });
  assert.deepEqual(x.quote, { id: "q", author: "Unknown", fromMe: true, text: "hi" });
  assert.equal(x.receipt, "read");
  assert.equal(x.deleted, true);
  const none = whatsappExtras({ quoted: { id: "q" }, reactions: {}, receipt: "bogus" });
  assert.equal(none.quote, undefined);
  assert.equal(none.reactions, undefined);
  assert.equal(none.receipt, undefined);
  assert.equal(whatsappExtras(null).edited, undefined);
});

test("a team copy of a file wins as the path and has no thumbnail", () => {
  const base = { id: "1", filename: "a.pdf", kind: "pdf", size_bytes: 10, storage_path: "own", sealed: false, not_kept: null };
  assert.equal(mapAttachment({ ...base, team_path: "team", thumb_path: "th" }).path, "team");
  assert.equal(mapAttachment({ ...base, team_path: "team", thumb_path: "th" }).thumbPath, undefined);
  assert.equal(mapAttachment({ ...base, thumb_path: "th" }).thumbPath, "th");
  assert.equal(mapAttachment({ ...base, thumb_path: "" }).thumbPath, undefined);
  assert.equal(mapAttachment(base).sealed, undefined);
});

test("stored marks are used, and unreadable ones fall back to nothing", () => {
  assert.equal(emailMarks({ body_html: null, body_marks: "not json" }), undefined);
  assert.equal(emailMarks({ body_html: null, body_marks: "[]" }), undefined);
  const runs = [{ start: 0, end: 3, bold: true }];
  assert.deepEqual(emailMarks({ body_html: null, body_marks: JSON.stringify(runs) }), runs);
});

const held = (over: Partial<Message> = {}): Message => ({ id: "m", providerId: "p", threadId: "t", from: "me", sentAt: "2026-01-01", body: "old", hasOriginal: false, ...over } as Message);

test("a chat message takes new text and reactions, and an untouched one is returned as the same object", () => {
  const wa = held({ whatsapp: true });
  assert.equal(patchMessage(wa, { body_text: "new" }).body, "new");
  assert.deepEqual(patchMessage(wa, { provider_meta: { reactions: { a: "x" } } }).reactions, { a: "x" });
  assert.equal(patchMessage(wa, { body_text: "old" }), wa);
  assert.equal(patchMessage(wa, {}), wa);
});

test("a voice note transcript written later is added", () => {
  assert.equal(patchMessage(held(), { transcript: "hello" }).transcript, "hello");
});

test("a held voice note offers Transcribe, then shows it is queued once asked, until the transcript arrives", () => {
  assert.deepEqual(transcriptFlags("deferred"), { transcriptDeferred: true, transcriptRequested: undefined });
  assert.deepEqual(transcriptFlags("requested"), { transcriptDeferred: undefined, transcriptRequested: true });
  assert.deepEqual(transcriptFlags(null), { transcriptDeferred: undefined, transcriptRequested: undefined });
  const asked = patchMessage(held({ transcriptDeferred: true }), { transcript_status: "requested" });
  assert.equal(asked.transcriptRequested, true);
  assert.equal(asked.transcriptDeferred, undefined);
  const done = patchMessage(asked, { transcript: "hello", transcript_status: "done" });
  assert.equal(done.transcriptRequested, undefined);
  assert.equal(done.transcript, "hello");
});

test("a missed call and a poll with votes come through provider_meta", () => {
  const x = whatsappExtras({ call: { video: true, missed: true }, poll: { multi: true }, poll_votes: { a: [0, 1] } });
  assert.deepEqual(x.call, { video: true, missed: true });
  assert.deepEqual(x.poll, { multi: true, votes: { a: [0, 1] } });
  assert.equal(whatsappExtras({}).call, undefined);
  assert.equal(whatsappExtras({}).poll, undefined);
});

test("a vote arriving by Realtime changes the poll the bubble shows", () => {
  const poll = { id: "m", threadId: "t", from: "u", sentAt: "", body: "Poll: Q\n• A\n• B", whatsapp: true, poll: { multi: false, votes: {} } };
  const next = patchMessage(poll, { provider_meta: { poll: { multi: false }, poll_votes: { x: [1] } } });
  assert.deepEqual(next.poll?.votes, { x: [1] });
});
