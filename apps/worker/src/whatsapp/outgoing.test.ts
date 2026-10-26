import { test } from "node:test";
import assert from "node:assert/strict";
import { fileMessage, newChatNumber, outgoingMessages } from "./outgoing";

const file = (contentType: string, filename = "f") => ({ filename, contentType, content: Buffer.from("x") });

test("text alone is one text message; nothing at all is nothing", () => {
  assert.deepEqual(outgoingMessages("  Hi  ", []), [{ text: "Hi" }]);
  assert.deepEqual(outgoingMessages("   ", []), []);
});

test("photos, videos, audio and documents each get the right kind", () => {
  assert.ok("image" in fileMessage(file("image/jpeg")));
  assert.ok("video" in fileMessage(file("video/mp4")));
  assert.ok("audio" in fileMessage(file("audio/mpeg")));
  const doc = fileMessage(file("application/pdf", "Invoice.pdf"));
  assert.ok("document" in doc && doc.fileName === "Invoice.pdf");
  // Formats some phones cannot show inline still arrive, as documents.
  assert.ok("document" in fileMessage(file("image/heic")));
  assert.ok("document" in fileMessage(file("video/quicktime")));
});

test("a converted voice note goes as a voice note, with its length and waveform", () => {
  const waveform = new Uint8Array(64);
  const note = { filename: "Voice Note.ogg", contentType: "audio/ogg", content: Buffer.from("x"), voice: { seconds: 7, waveform } };
  assert.deepEqual(fileMessage(note), { audio: note.content, mimetype: "audio/ogg; codecs=opus", ptt: true, seconds: 7, waveform });
  assert.deepEqual(fileMessage(file("audio/ogg")), { audio: Buffer.from("x"), mimetype: "audio/ogg", ptt: false });
  // The text goes on its own first, as a voice note carries no caption.
  const out = outgoingMessages("Listen", [note]);
  assert.deepEqual(out[0], { text: "Listen" });
  assert.equal((out[1] as { ptt?: boolean }).ptt, true);
});

test("the text is the caption of the first file that can carry one", () => {
  const out = outgoingMessages("Look", [file("image/png"), file("application/pdf")]);
  assert.equal(out.length, 2);
  assert.equal((out[0] as { caption?: string }).caption, "Look");
  assert.equal((out[1] as { caption?: string }).caption, undefined);
  const afterAudio = outgoingMessages("Listen", [file("audio/ogg"), file("image/jpeg")]);
  assert.equal((afterAudio[1] as { caption?: string }).caption, "Listen");
});

test("with only audio, the text goes first on its own", () => {
  const out = outgoingMessages("Listen", [file("audio/ogg")]);
  assert.deepEqual(out[0], { text: "Listen" });
  assert.ok("audio" in out[1]);
});

test("files with no text send no empty caption", () => {
  const out = outgoingMessages("", [file("image/jpeg")]);
  assert.equal(out.length, 1);
  assert.equal("caption" in out[0], false);
});

test("a new chat names exactly one number in E.164", () => {
  assert.equal(newChatNumber(["+27815956488"]), "27815956488");
  assert.equal(newChatNumber([" +447700900123 "]), "447700900123");
  assert.equal(newChatNumber(["0815956488"]), null);
  assert.equal(newChatNumber(["+0815956488"]), null);
  assert.equal(newChatNumber(["+27 81 595 6488"]), null);
  assert.equal(newChatNumber(["+123"]), null);
  assert.equal(newChatNumber(["+27815956488", "+447700900123"]), null);
  assert.equal(newChatNumber([]), null);
});
