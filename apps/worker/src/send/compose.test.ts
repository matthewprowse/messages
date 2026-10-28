// Tests for send/compose.ts: reply subjects and message IDs, threading headers, attachments after the text, Cc and Bcc handling,
// and that line breaks in an address cannot inject a header. Messages are built, then parsed back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNewEmail, buildReply, newMessageId, replySubject } from "./compose";

test("reply subjects get one Re: prefix", () => {
  assert.equal(replySubject("Saturday"), "Re: Saturday");
  assert.equal(replySubject("Re: Saturday"), "Re: Saturday");
  assert.equal(replySubject("RE:Saturday"), "RE:Saturday");
  assert.equal(replySubject(null), "Re:");
});

test("message ids use the sender's domain", () => {
  assert.match(newMessageId("matthew@prowse.co.za"), /^<[0-9a-f-]{36}@prowse\.co\.za>$/);
});

test("a reply threads onto the conversation", async () => {
  const raw = (
    await buildReply(
      {
        from: { name: "Matthew", address: "matthew@prowse.co.za" },
        to: ["julia@example.com"],
        subject: "Saturday",
        inReplyTo: "<b@example.com>",
        references: ["<a@example.com>"],
        body: "Sounds good.\nSee you then.",
      },
      "<id@prowse.co.za>",
    )
  ).toString();
  assert.match(raw, /^Subject: Re: Saturday$/m);
  assert.match(raw, /^In-Reply-To: <b@example\.com>$/m);
  assert.match(raw, /^References: <a@example\.com> <b@example\.com>$/m);
  assert.match(raw, /^Message-ID: <id@prowse\.co\.za>$/m);
  assert.match(raw, /^From: Matthew <matthew@prowse\.co\.za>$/m);
  assert.match(raw, /Sounds good\./);
});

test("a new email starts its own conversation", async () => {
  const raw = (
    await buildNewEmail(
      {
        from: { name: "Matthew", address: "hello@prowse.co.za" },
        to: ["julia@example.com", "sam@example.com"],
        subject: "Saturday\r\nBcc: someone@example.com",
        body: "Are you free?",
      },
      "<new@prowse.co.za>",
    )
  ).toString();
  assert.match(raw, /^Subject: Saturday Bcc: someone@example\.com$/m);
  assert.doesNotMatch(raw, /^Bcc:/m);
  assert.doesNotMatch(raw, /^In-Reply-To:/m);
  assert.doesNotMatch(raw, /^References:/m);
  assert.doesNotMatch(raw, /^Subject: Re:/m);
  assert.match(raw, /^To: julia@example\.com, sam@example\.com$/m);
  assert.match(raw, /^From: Matthew <hello@prowse\.co\.za>$/m);
  assert.match(raw, /^Message-ID: <new@prowse\.co\.za>$/m);
});

test("files are attached after the text, in order, and parse back unchanged", async () => {
  const { simpleParser } = await import("mailparser");
  const pdf = Buffer.from("%PDF-1.4 fake pdf bytes");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
  const raw = await buildReply(
    {
      from: { name: null, address: "matthew@prowse.co.za" },
      to: ["julia@example.com"],
      subject: "Saturday",
      inReplyTo: "<b@example.com>",
      references: [],
      body: "Here you go.",
      attachments: [
        { filename: "Plan.pdf", contentType: "application/pdf", content: pdf },
        { filename: "Café menu.png", contentType: "image/png", content: png },
      ],
    },
    "<files@prowse.co.za>",
  );
  assert.match(raw.toString(), /^Content-Type: multipart\/mixed; boundary=/m);
  assert.match(raw.toString(), /^In-Reply-To: <b@example\.com>$/m);
  const parsed = await simpleParser(raw);
  assert.equal(parsed.text?.trim(), "Here you go.");
  assert.deepEqual(
    parsed.attachments.map((a) => [a.filename, a.contentType, a.contentDisposition]),
    [
      ["Plan.pdf", "application/pdf", "attachment"],
      ["Café menu.png", "image/png", "attachment"],
    ],
  );
  assert.ok(parsed.attachments[0].content.equals(pdf));
  assert.ok(parsed.attachments[1].content.equals(png));
});

test("a new email can carry files with no text", async () => {
  const { simpleParser } = await import("mailparser");
  const raw = await buildNewEmail(
    {
      from: { name: null, address: "hello@prowse.co.za" },
      to: ["julia@example.com"],
      subject: "Photos",
      body: "",
      attachments: [{ filename: "a.jpg", contentType: "image/jpeg", content: Buffer.from("jpeg") }],
    },
    "<photo@prowse.co.za>",
  );
  const parsed = await simpleParser(raw);
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].filename, "a.jpg");
  assert.equal(parsed.subject, "Photos");
});

test("an email without files stays a single text part", async () => {
  const raw = (
    await buildNewEmail({ from: { name: null, address: "hello@prowse.co.za" }, to: ["julia@example.com"], subject: "Hi", body: "Hello", attachments: [] }, "<plain@prowse.co.za>")
  ).toString();
  assert.match(raw, /^Content-Type: text\/plain/m);
  assert.doesNotMatch(raw, /multipart/);
});

test("Cc is a header everyone sees, and Bcc is left out unless the provider strips it", async () => {
  const input = {
    from: { name: null, address: "matthew@prowse.co.za" },
    to: ["julia@example.com"],
    cc: ["sam@example.com"],
    bcc: ["boss@example.com"],
    subject: "Saturday",
    body: "Hi",
  };
  const plain = (await buildNewEmail(input, "<a@prowse.co.za>")).toString();
  assert.match(plain, /^Cc: sam@example\.com$/m);
  assert.doesNotMatch(plain, /^Bcc:/m);
  assert.doesNotMatch(plain, /boss@example\.com/);
  const kept = (await buildReply({ ...input, inReplyTo: null, references: [] }, "<b@prowse.co.za>", true)).toString();
  assert.match(kept, /^Bcc: boss@example\.com$/m);
});

test("line breaks in an address cannot start a header", async () => {
  const raw = (
    await buildNewEmail(
      { from: { name: null, address: "m@prowse.co.za" }, to: ["a@example.com"], cc: ["b@example.com\r\nX-Evil: 1"], subject: "S", body: "Hi" },
      "<c@prowse.co.za>",
    )
  ).toString();
  assert.doesNotMatch(raw, /^X-Evil:/m);
});
