// Tests for whatsapp/gif.ts: which files go as GIFs, their names, and the conversion's settings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { convertGif, gifArgs, gifName, isGif, prepareGifs } from "./gif";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

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

test("ffmpeg may only read the pipe, as a GIF, with the output capped", () => {
  const args = gifArgs("/tmp/x/out.mp4");
  const input = args.indexOf("-i");
  assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "pipe");
  assert.equal(args[args.indexOf("-f") + 1], "gif");
  assert.ok(args.indexOf("-protocol_whitelist") < input && args.indexOf("-f") < input && args.indexOf("-t") < input);
  assert.ok(Number(args[args.indexOf("-fs") + 1]) > 0);
});

test("a file marked as a GIF that is not one fails the row, before ffmpeg runs", async () => {
  const out = await prepareGifs([{ filename: "a.gif", contentType: "image/gif", content: Buffer.from("#EXTM3U\nhttp://169.254.169.254/") }], {});
  assert.ok("error" in out && /could not be prepared/.test(out.error));
  await assert.rejects(convertGif(Buffer.from("not a gif")), { code: "NOT_GIF" });
});

test("a real GIF becomes an MP4", { skip: !hasFfmpeg }, async () => {
  const gif = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=65x49:rate=10:duration=1", "-f", "gif", "pipe:1"]).stdout;
  const mp4 = await convertGif(gif);
  assert.equal(mp4.subarray(4, 8).toString(), "ftyp");
});

test("a reply with no GIFs is left as it is", async () => {
  const files = [{ filename: "a.png", contentType: "image/png", content: Buffer.from("x") }];
  assert.equal(await prepareGifs(files, {}), files);
});
