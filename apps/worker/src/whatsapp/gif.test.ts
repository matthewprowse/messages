// Tests for whatsapp/gif.ts: which files go as GIFs, their names, and the conversion's settings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { gifArgs, gifName, isGif, prepareGifs } from "./gif";

test("only image/gif files go as GIFs", () => {
  assert.equal(isGif({ contentType: "image/gif" }), true);
  assert.equal(isGif({ contentType: "IMAGE/GIF" }), true);
  assert.equal(isGif({ contentType: "video/mp4" }), false);
});

test("a GIF keeps its name as an MP4", () => {
  assert.equal(gifName("Party.gif"), "Party.mp4");
  assert.equal(gifName(".gif"), "GIF.mp4");
});

test("the conversion is silent H.264 with even sides and the index first", () => {
  const args = gifArgs("/tmp/x/out.mp4");
  assert.ok(args.includes("-an"));
  assert.equal(args[args.indexOf("-pix_fmt") + 1], "yuv420p");
  assert.equal(args[args.indexOf("-movflags") + 1], "+faststart");
  assert.equal(args.at(-1), "/tmp/x/out.mp4");
});

test("a reply with no GIFs is left as it is", async () => {
  const files = [{ filename: "a.png", contentType: "image/png", content: Buffer.from("x") }];
  assert.equal(await prepareGifs(files, {}), files);
});
