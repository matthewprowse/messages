import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, e164, formatPairingCode, nameMentions, oneLine, pairingDigits, unreadInHistory } from "./normalize";

test("plain and extended text", () => {
  assert.deepEqual(describe({ conversation: "Hello there" }), {
    kind: "message",
    type: "conversation",
    text: "Hello there",
    preview: "Hello there",
    media: null,
    quoted: null,
    mentions: [],
  });
  const d = describe({ extendedTextMessage: { text: "See https://example.com" } });
  assert.equal(d.kind === "message" && d.text, "See https://example.com");
});

test("disappearing and view once messages are unwrapped", () => {
  const d = describe({ ephemeralMessage: { message: { conversation: "Gone soon" } } });
  assert.equal(d.kind === "message" && d.text, "Gone soon");
});

test("photo with a caption keeps the caption as text and becomes an image file", () => {
  const d = describe({ imageMessage: { caption: "Look", mimetype: "image/jpeg", fileLength: 2048 } });
  assert.ok(d.kind === "message");
  assert.equal(d.text, "Look");
  assert.equal(d.preview, "Look");
  assert.deepEqual(d.media, { type: "imageMessage", filename: "Photo.jpg", mimeType: "image/jpeg", kind: "image", sizeBytes: 2048 });
});

test("photo without a caption previews as Photo", () => {
  const d = describe({ imageMessage: { mimetype: "image/png" } });
  assert.ok(d.kind === "message");
  assert.equal(d.text, "");
  assert.equal(d.preview, "Photo");
  assert.equal(d.media?.filename, "Photo.png");
});

test("voice note shows its length and is audio", () => {
  const d = describe({ audioMessage: { ptt: true, seconds: 75, mimetype: "audio/ogg; codecs=opus" } });
  assert.ok(d.kind === "message");
  assert.equal(d.preview, "Voice Note (1:15)");
  assert.equal(d.media?.filename, "Voice Note.ogg");
  assert.equal(d.media?.kind, "audio");
});

test("documents keep their file name, PDFs are pdf, documents with captions unwrap", () => {
  const pdf = describe({ documentMessage: { fileName: "Invoice.pdf", mimetype: "application/pdf", fileLength: 10 } });
  assert.ok(pdf.kind === "message");
  assert.equal(pdf.media?.kind, "pdf");
  assert.equal(pdf.preview, "Document: Invoice.pdf");
  const captioned = describe({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "a.txt", caption: "Notes", mimetype: "text/plain" } } } });
  assert.ok(captioned.kind === "message");
  assert.equal(captioned.text, "Notes");
  assert.equal(captioned.media?.filename, "a.txt");
});

test("video notes and GIFs", () => {
  const note = describe({ ptvMessage: { mimetype: "video/mp4" } });
  assert.ok(note.kind === "message" && note.preview === "Video Note" && note.media?.type === "ptvMessage");
  const gif = describe({ videoMessage: { gifPlayback: true, mimetype: "video/mp4" } });
  assert.ok(gif.kind === "message" && gif.preview === "GIF");
});

test("quoted replies carry the quoted message's id, author and text", () => {
  const d = describe({
    extendedTextMessage: {
      text: "Yes",
      contextInfo: { stanzaId: "ABC", participant: "447700900123@s.whatsapp.net", quotedMessage: { conversation: "Coming tonight?" } },
    },
  });
  assert.ok(d.kind === "message");
  assert.deepEqual(d.quoted, { id: "ABC", participant: "447700900123@s.whatsapp.net", text: "Coming tonight?" });
});

test("a quoted photo is summarised", () => {
  const d = describe({ extendedTextMessage: { text: "Nice", contextInfo: { stanzaId: "X", quotedMessage: { imageMessage: {} } } } });
  assert.ok(d.kind === "message" && d.quoted?.text === "Photo");
});

test("reactions point at their message; removals have no emoji", () => {
  assert.deepEqual(describe({ reactionMessage: { key: { id: "M1" }, text: "👍" } }), { kind: "reaction", targetId: "M1", emoji: "👍" });
  assert.deepEqual(describe({ reactionMessage: { key: { id: "M1" }, text: "" } }), { kind: "reaction", targetId: "M1", emoji: "" });
});

test("protocol messages, key sharing and empty messages are skipped", () => {
  assert.deepEqual(describe({ protocolMessage: { type: 0 } }), { kind: "skip" });
  assert.deepEqual(describe({ senderKeyDistributionMessage: {} }), { kind: "skip" });
  assert.deepEqual(describe(null), { kind: "skip" });
});

test("location and polls are readable text", () => {
  const loc = describe({ locationMessage: { degreesLatitude: 51.5, degreesLongitude: -0.12, name: "Cafe" } });
  assert.ok(loc.kind === "message" && loc.text === "Location: Cafe\nhttps://maps.google.com/?q=51.5,-0.12");
  const poll = describe({ pollCreationMessageV3: { name: "Lunch?", options: [{ optionName: "Yes" }, { optionName: "No" }] } });
  assert.ok(poll.kind === "message" && poll.text === "Poll: Lunch?\n• Yes\n• No");
});

test("phone numbers in E.164 only for phone-number JIDs", () => {
  assert.equal(e164("447700900123@s.whatsapp.net"), "+447700900123");
  assert.equal(e164("447700900123:12@s.whatsapp.net"), "+447700900123");
  assert.equal(e164("123456789012345@lid"), null);
  assert.equal(e164("120363000000000000@g.us"), null);
  assert.equal(e164(undefined), null);
});

test("pairing numbers and codes", () => {
  assert.equal(pairingDigits("+44 7700 900123"), "447700900123");
  assert.equal(pairingDigits("12"), null);
  assert.equal(formatPairingCode("abcd1234"), "ABCD-1234");
});

test("mentions use names where known", () => {
  const text = nameMentions("Hi @447700900123 and @999", ["447700900123@s.whatsapp.net", "999@lid"], (jid) => (jid.startsWith("4477") ? "Sam" : null));
  assert.equal(text, "Hi @Sam and @999");
});

test("one line previews are trimmed", () => {
  assert.equal(oneLine("a\n\nb   c"), "a b c");
  assert.equal(oneLine("x".repeat(10), 5), "xxxx…");
});

test("history unread: the newest N messages from others per chat", () => {
  const msgs = [
    { id: "1", chat: "a", fromMe: false, at: 1 },
    { id: "2", chat: "a", fromMe: true, at: 2 },
    { id: "3", chat: "a", fromMe: false, at: 3 },
    { id: "4", chat: "a", fromMe: false, at: 4 },
    { id: "5", chat: "b", fromMe: false, at: 5 },
  ];
  assert.deepEqual([...unreadInHistory(msgs, new Map([["a", 2]]))].sort(), ["3", "4"]);
});

test("business and invite messages become text; albums are skipped since their photos follow", () => {
  const invite = describe({ groupInviteMessage: { groupName: "Climbing" } });
  assert.ok(invite.kind === "message" && invite.text === "Group Invite: Climbing" && !invite.unsupported);
  const buttons = describe({ buttonsMessage: { contentText: "Your order shipped", footerText: "Shop" } });
  assert.ok(buttons.kind === "message" && buttons.text === "Your order shipped\nShop");
  assert.deepEqual(describe({ albumMessage: { expectedImageCount: 3 } }), { kind: "skip" });
});

test("animated stickers and bot replies are unwrapped", () => {
  const sticker = describe({ lottieStickerMessage: { message: { stickerMessage: { mimetype: "application/was" } } } });
  assert.ok(sticker.kind === "message" && sticker.preview === "Sticker");
  const bot = describe({ botInvokeMessage: { message: { conversation: "Hi from a bot" } } });
  assert.ok(bot.kind === "message" && bot.text === "Hi from a bot");
});

test("unknown types are flagged and say where to look", () => {
  const d = describe({ requestPhoneNumberMessage: {} });
  assert.ok(d.kind === "message" && d.unsupported === true && d.type === "requestPhoneNumberMessage");
});
