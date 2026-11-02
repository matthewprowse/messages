// Tests for the pure helpers in lib/attachment-view.ts: file name and swipe maths, the viewer's not-kept wording,
// download links and the grid's month and count labels.

import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadLink, extensionOf, filesLabel, isSticker, messageHref, monthKey, notKeptMessage, SOURCE_LABEL, sourceOf, swipeOf } from "./attachment-view";
import { FETCH_TEXT } from "./attachment-fetch";
import type { Attachment, FiledAttachment } from "./types";

const file = (over: Partial<Attachment>) => ({ id: "a", name: "x.pdf", kind: "pdf", ...over }) as Attachment;

test("an extension is upper cased, and a name without a plausible one has none", () => {
  assert.equal(extensionOf("report.pdf"), "PDF");
  assert.equal(extensionOf("archive.tar.gz"), "GZ");
  assert.equal(extensionOf("README"), "");
  assert.equal(extensionOf(".hidden"), "");
  assert.equal(extensionOf("a.verylongtail"), "");
});

test("only Sticker images count as stickers", () => {
  assert.equal(isSticker(file({ kind: "image", name: "Sticker.webp" })), true);
  assert.equal(isSticker(file({ kind: "image", name: "photo.webp" })), false);
  assert.equal(isSticker(file({ kind: "file", name: "Sticker.webp" })), false);
});

test("a swipe needs distance and has to be mostly horizontal", () => {
  assert.equal(swipeOf(-80, 0), 1);
  assert.equal(swipeOf(80, 10), -1);
  assert.equal(swipeOf(-40, 0), 0);
  assert.equal(swipeOf(-80, 70), 0);
});

test("a download link keeps the viewing link and adds the file name", () => {
  const url = new URL(downloadLink("https://x.test/f?token=1", "a b.pdf"));
  assert.equal(url.searchParams.get("token"), "1");
  assert.equal(url.searchParams.get("download"), "a b.pdf");
});

test("the not-kept message says why a file has no copy", () => {
  assert.equal(notKeptMessage(file({ notKept: "unavailable" }), true), FETCH_TEXT.gone);
  assert.match(notKeptMessage(file({ notKept: "deferred" }), true), /^Not downloaded\./);
  assert.match(notKeptMessage(file({ notKept: "deleted" }), true), /^Deleted from Konva\./);
  assert.match(notKeptMessage(file({ notKept: "video_link" }), true), /Large videos/);
  assert.match(notKeptMessage(file({ notKept: "over_cap" }), true), /storage is full/);
  assert.match(notKeptMessage(file({}), true), /^Not kept here\./);
  assert.match(notKeptMessage(file({}), false), /^Not downloaded yet\./);
});

test("every connected provider that carries files is a source, and a calendar is not", () => {
  for (const p of ["outlook", "linkedin", "instagram", "imap", "icloud", "whatsapp"] as const) assert.equal(sourceOf(p), p);
  assert.equal(SOURCE_LABEL.outlook, "Outlook");
  assert.equal(sourceOf("google_calendar"), undefined);
});

test("sources, months, counts and message links read as the grid shows them", () => {
  assert.equal(sourceOf("gmail"), "gmail");
  assert.equal(sourceOf(undefined), undefined);
  assert.equal(monthKey("2026-10-14T12:00:00Z"), "2026-10");
  assert.equal(monthKey(new Date(2026, 9, 1, 0, 30).toISOString()), "2026-10"); // local midnight on the 1st is October everywhere
  assert.equal(filesLabel(1), "1 File");
  assert.equal(filesLabel(2), "2 Files");
  assert.equal(messageHref({ threadId: "t1", messageId: "m1" } as FiledAttachment), "/inbox/t1?message=m1");
});
