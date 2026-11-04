// Tests for ingest/normalize-email.ts over parsed raw messages. Pin down thread roots and References, inline images versus
// files, fallback ids, previews, derived names and unsubscribe headers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { simpleParser } from "mailparser";
import { nameFromAddress, normalizeEmail, previewOf, replyToDomainOf } from "./normalize-email";

const original = [
  "Message-ID: <root-1@hartleylaw.co.uk>",
  "From: James Whitfield <James.Whitfield@HartleyLaw.co.uk>",
  "To: Matt <matt@prowse.me>",
  "Cc: Team: a@example.com, b@example.com;",
  "Subject: Lease renewal",
  "Date: Tue, 20 Oct 2026 09:15:00 +0100",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Please find the revised terms.",
].join("\r\n");

const reply = [
  "Message-ID: <reply-3@hartleylaw.co.uk>",
  "In-Reply-To: <reply-2@prowse.me>",
  "References: <root-1@hartleylaw.co.uk> <reply-2@prowse.me>",
  "From: James Whitfield <james.whitfield@hartleylaw.co.uk>",
  "To: matt@prowse.me",
  "Subject: Re: Lease renewal",
  "Date: Thu, 22 Oct 2026 09:24:00 +0100",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  'Content-Type: multipart/related; boundary="b2"',
  "",
  "--b2",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>The landlord agreed.</p><img src="cid:logo">',
  "--b2",
  "Content-Type: image/png",
  "Content-ID: <logo>",
  "Content-Disposition: inline; filename=logo.png",
  "Content-Transfer-Encoding: base64",
  "",
  "iVBORw0KGgo=",
  "--b2--",
  "--b1",
  "Content-Type: application/pdf",
  "Content-Disposition: attachment; filename=Heads_of_Terms.pdf",
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQK",
  "--b1--",
].join("\r\n");

test("a first message is its own thread root", async () => {
  const mail = normalizeEmail(await simpleParser(original), "fallback");
  assert.equal(mail.providerMessageId, "<root-1@hartleylaw.co.uk>");
  assert.equal(mail.threadRoot, "<root-1@hartleylaw.co.uk>");
  assert.equal(mail.from?.address, "james.whitfield@hartleylaw.co.uk", "addresses are lowercased");
  assert.equal(mail.from?.name, "James Whitfield");
  assert.deepEqual(mail.cc.map((c) => c.address), ["a@example.com", "b@example.com"], "group syntax is flattened");
  assert.equal(mail.subject, "Lease renewal");
});

test("a reply joins the original conversation through References", async () => {
  const mail = normalizeEmail(await simpleParser(reply), "fallback");
  assert.equal(mail.threadRoot, "<root-1@hartleylaw.co.uk>");
  assert.equal(mail.inReplyTo, "<reply-2@prowse.me>");
  assert.deepEqual(mail.references, ["<root-1@hartleylaw.co.uk>", "<reply-2@prowse.me>"]);
});

test("inline images are not attachments, real files are", async () => {
  const mail = normalizeEmail(await simpleParser(reply), "fallback");
  assert.deepEqual(
    mail.attachments.map((a) => [a.filename, a.kind]),
    [["Heads_of_Terms.pdf", "pdf"]],
  );
  assert.ok(mail.html?.includes("The landlord agreed."));
});

test("a message without a Message-ID gets the stable fallback", async () => {
  const mail = normalizeEmail(await simpleParser("From: a@b.com\r\nSubject: hi\r\n\r\nbody"), "INBOX:1:42");
  assert.equal(mail.providerMessageId, "INBOX:1:42");
  assert.equal(mail.threadRoot, "INBOX:1:42");
});

test("previews drop quoted history", () => {
  const text = "Sounds good, Thursday works.\n\nOn Tue, 20 Oct 2026, James wrote:\n> Can we meet Thursday?";
  assert.equal(previewOf(text), "Sounds good, Thursday works.");
  assert.equal(previewOf("Top line\n> quoted"), "Top line");
  assert.equal(previewOf(null), null);
  assert.equal(previewOf("x".repeat(300))?.length, 160);
});

test("previews ignore links and image addresses", () => {
  assert.equal(previewOf("[https://example.com/a.png]\nhttps://example.com/track"), null);
  assert.equal(previewOf("See the offer https://example.com/x today"), "See the offer today");
});

test("names are derived from addresses when missing", () => {
  assert.equal(nameFromAddress("sarah.okafor@northlane.co"), "Sarah Okafor");
  assert.equal(nameFromAddress("lettings@brightwater.co.uk"), "Lettings");
});

test("an email with no readable text previews as its subject", async () => {
  const raw = 'From: news@example.com\r\nSubject: October Offers\r\nContent-Type: text/html\r\n\r\n<img src="https://example.com/banner.png">';
  const mail = normalizeEmail(await simpleParser(raw), "fallback");
  assert.equal(mail.preview, "October Offers");
});

test("an email with text previews as its text", async () => {
  const mail = normalizeEmail(await simpleParser(original), "fallback");
  assert.equal(mail.preview, "Please find the revised terms.");
});

test("styled Unicode letters become plain text", async () => {
  const { plainLetters } = await import("./normalize-email");
  assert.equal(plainLetters("𝗬𝗼𝘂𝗿 𝗖𝗩 𝗶𝘀 𝗶𝗻 𝗵𝗶𝗴𝗵 𝗱𝗲𝗺𝗮𝗻𝗱"), "Your CV is in high demand");
  assert.equal(plainLetters("𝘪𝘵𝘢𝘭𝘪𝘤 ℎ𝑒𝑙𝑙𝑜 𝟐𝟎𝟐𝟔 Ｆｕｌｌ"), "italic hello 2026 Full");
  assert.equal(plainLetters("m² café ™ 😀"), "m² café ™ 😀");
});

test("unsubscribe headers are kept, unfolded", async () => {
  const raw = [
    "From: News <news@shop.example>",
    "To: me@example.com",
    "Subject: Sale",
    "Message-ID: <n1@shop.example>",
    "List-Unsubscribe: <https://shop.example/u?id=1>,",
    " <mailto:unsub@shop.example?subject=unsubscribe>",
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "",
    "Hello",
  ].join("\r\n");
  const mail = normalizeEmail(await simpleParser(raw), "x");
  assert.equal(mail.listUnsubscribe, "<https://shop.example/u?id=1>, <mailto:unsub@shop.example?subject=unsubscribe>");
  assert.equal(mail.listUnsubscribePost, true);
});

test("the receiving server's verdicts are read from its topmost Authentication-Results header", async () => {
  const raw = [
    "Authentication-Results: mx.google.com;",
    "       dkim=pass header.i=@hartleylaw.co.uk;",
    "       spf=pass (google.com: domain of x designates 1.2.3.4) smtp.mailfrom=x@hartleylaw.co.uk;",
    "       dmarc=pass (p=REJECT) header.from=hartleylaw.co.uk",
    "Authentication-Results: forged.example; dmarc=fail",
    original,
  ].join("\r\n");
  assert.deepEqual(normalizeEmail(await simpleParser(raw), "x").auth, { spf: "pass", dkim: "pass", dmarc: "pass" });
  assert.equal(normalizeEmail(await simpleParser(original), "x").auth, null);
});

test("the content hash is the same for the same email in another folder, and differs when the email does", async () => {
  const a = normalizeEmail(await simpleParser(original), "x");
  const moved = normalizeEmail(await simpleParser(["X-Folder: Archive", original].join("\r\n")), "y");
  const other = normalizeEmail(await simpleParser(original.replace("revised terms", "new bank details")), "x");
  assert.equal(a.providerMessageId, other.providerMessageId);
  assert.equal(a.contentHash, moved.contentHash);
  assert.notEqual(a.contentHash, other.contentHash);
  assert.match(a.contentHash, /^[0-9a-f]{64}$/);
});

test("only the domain of a Reply-To at another domain is kept, never the address", async () => {
  const withReplyTo = (value: string) => ["Reply-To: " + value, original].join("\r\n");
  assert.equal(normalizeEmail(await simpleParser(withReplyTo("Accounts <Pay@Other-Bank.example>")), "x").replyToDomain, "other-bank.example");
  assert.equal(normalizeEmail(await simpleParser(withReplyTo("james+replies@hartleylaw.co.uk")), "x").replyToDomain, null);
  assert.equal(normalizeEmail(await simpleParser(original), "x").replyToDomain, null);
  const from = { address: "a@acme.com", name: null };
  assert.equal(replyToDomainOf(from, [{ address: "b@acme.com", name: null }, { address: "c@evil.biz", name: null }]), "evil.biz");
  assert.equal(replyToDomainOf(null, [{ address: "c@evil.biz", name: null }]), "evil.biz");
  assert.equal(replyToDomainOf(from, [{ address: "no-at-sign", name: null }, { address: "x@bad domain", name: null }]), null);
});
