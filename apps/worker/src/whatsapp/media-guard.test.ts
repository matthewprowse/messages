// Tests for whatsapp/media-guard.ts: which direct paths, hosts and picture links are fetched, and the byte cap on reading.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { proto } from "baileys";
import { downloadable, isWhatsAppHost, isWhatsAppPhotoUrl, mediaHost, readCapped, safeDirectPath, WA_MEDIA_HOST } from "./media-guard";

const REAL = "/v/t62.7118-24/31377688_1234567890_n.enc?ccb=11-4&oh=01_Q5AaIabc-DEF_ghi&oe=6789ABCD&_nc_sid=5e03e0&mms3=true";

test("a real direct path is kept as it is", () => {
  assert.equal(safeDirectPath(REAL), REAL);
  assert.equal(safeDirectPath("/mms/image/abc%3D~x"), "/mms/image/abc%3D~x");
});

test("a direct path that could move the request to another host is refused", () => {
  for (const bad of [
    "@evil.com/x", // https://mmg.whatsapp.net@evil.com/x
    "/x@evil.com",
    "evil.com/x",
    "https://evil.com/x",
    "/x:80",
    "/x\\y",
    "/x y",
    "/x#y",
    "/x\n",
    "/",
    "",
    "/" + "a".repeat(5000),
  ]) assert.equal(safeDirectPath(bad), null, bad);
  assert.equal(safeDirectPath(null), null);
  assert.equal(safeDirectPath(undefined), null);
  assert.equal(safeDirectPath(42), null);
});

const KEY = new Uint8Array(32).fill(7);

test("a file is fetched by its checked path and key, never by the sender's url", () => {
  const msg = { imageMessage: { url: "http://169.254.169.254/latest", directPath: REAL, mediaKey: KEY } } as proto.IMessage;
  const file = downloadable(msg);
  assert.deepEqual(file, { type: "image", mediaKey: KEY, directPath: REAL });
  assert.equal(file && "url" in file, false);
});

test("a file with only a url, a bad path or no key is not fetched at all", () => {
  assert.equal(downloadable({ imageMessage: { url: "https://evil.com/x.enc", mediaKey: KEY } } as proto.IMessage), null);
  assert.equal(downloadable({ documentMessage: { url: "https://mmg.whatsapp.net/x", directPath: "@evil.com/x", mediaKey: KEY } } as proto.IMessage), null);
  assert.equal(downloadable({ audioMessage: { directPath: REAL } } as proto.IMessage), null);
  assert.equal(downloadable({ conversation: "hi" }), null);
  assert.equal(downloadable(null), null);
});

test("a file inside a disappearing or view once message is found, with Baileys' type name", () => {
  const msg = { ephemeralMessage: { message: { viewOnceMessageV2: { message: { videoMessage: { directPath: REAL, mediaKey: KEY } } } } } } as proto.IMessage;
  assert.equal(downloadable(msg)?.type, "video");
  assert.equal(downloadable({ ptvMessage: { directPath: REAL, mediaKey: KEY } } as proto.IMessage)?.type, "ptv");
  assert.equal(downloadable({ stickerMessage: { directPath: REAL, mediaKey: KEY } } as proto.IMessage)?.type, "sticker");
});

test("only hosts under whatsapp.net are media hosts", () => {
  assert.equal(isWhatsAppHost("mmg.whatsapp.net"), true);
  assert.equal(isWhatsAppHost("media-jnb1-1.cdn.whatsapp.net"), true);
  assert.equal(isWhatsAppHost("whatsapp.net.evil.com"), false);
  assert.equal(isWhatsAppHost("evilwhatsapp.net"), false);
  assert.equal(isWhatsAppHost("whatsapp.net"), false);
  assert.equal(isWhatsAppHost("mmg.whatsapp.net:8080"), false);
  assert.equal(mediaHost("media.fjnb1-1.fna.whatsapp.net"), "media.fjnb1-1.fna.whatsapp.net");
  assert.equal(mediaHost("evil.com"), WA_MEDIA_HOST);
  assert.equal(mediaHost(undefined), WA_MEDIA_HOST);
});

test("a profile picture link must be https on a whatsapp.net host", () => {
  assert.equal(isWhatsAppPhotoUrl("https://pps.whatsapp.net/v/t61.24694-24/1_n.jpg?ccb=11-4&oh=x&oe=y"), true);
  assert.equal(isWhatsAppPhotoUrl("http://pps.whatsapp.net/v/1.jpg"), false);
  assert.equal(isWhatsAppPhotoUrl("https://evil.com/pps.whatsapp.net.jpg"), false);
  assert.equal(isWhatsAppPhotoUrl("https://pps.whatsapp.net@evil.com/x"), false);
  assert.equal(isWhatsAppPhotoUrl("https://user:pw@pps.whatsapp.net/x"), false);
  assert.equal(isWhatsAppPhotoUrl("https://pps.whatsapp.net:8443/x"), false);
  assert.equal(isWhatsAppPhotoUrl("https://169.254.169.254/latest"), false);
  assert.equal(isWhatsAppPhotoUrl("not a link"), false);
  assert.equal(isWhatsAppPhotoUrl(undefined), false);
});

test("a body within the cap is read whole", async () => {
  const out = await readCapped(Readable.from([Buffer.from("ab"), Buffer.from("cd")]), 4);
  assert.equal(out?.toString(), "abcd");
});

test("a body past the cap stops early and ends the stream", async () => {
  let pulled = 0;
  const source = Readable.from((function* () {
    for (let i = 0; i < 1000; i++) { pulled++; yield Buffer.alloc(10); }
  })());
  assert.equal(await readCapped(source, 25), null);
  assert.ok(pulled < 1000);
  assert.equal(source.destroyed, true);
});

test("a web stream past the cap is cancelled", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) { c.enqueue(new Uint8Array(10)); },
    cancel() { cancelled = true; },
  });
  assert.equal(await readCapped(body, 25), null);
  assert.equal(cancelled, true);
});
