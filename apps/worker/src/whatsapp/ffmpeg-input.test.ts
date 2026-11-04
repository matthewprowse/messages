// Tests for whatsapp/ffmpeg-input.ts: file types from first bytes, the input options, and ffmpeg's bare environment.

import { test } from "node:test";
import assert from "node:assert/strict";
import { audioFormat, ffmpegEnv, inputArgs, isGifBytes } from "./ffmpeg-input";

test("a GIF is known by its first bytes, not its name or type", () => {
  assert.equal(isGifBytes(Buffer.from("GIF89a\x01\x00")), true);
  assert.equal(isGifBytes(Buffer.from("GIF87a")), true);
  assert.equal(isGifBytes(Buffer.from("GIF8")), false);
  assert.equal(isGifBytes(Buffer.from("#EXTM3U\nhttp://169.254.169.254/")), false);
  assert.equal(isGifBytes(Buffer.from("\x89PNG\r\n\x1a\n")), false);
});

test("browser recordings are told apart by their first bytes", () => {
  assert.equal(audioFormat(Buffer.from("OggS\x00\x02")), "ogg");
  assert.equal(audioFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01])), "matroska");
  assert.equal(audioFormat(Buffer.from("\x00\x00\x00\x20ftypisom")), "mov");
  assert.equal(audioFormat(Buffer.from("#EXTM3U\nfile:///etc/passwd")), null);
  assert.equal(audioFormat(Buffer.from("ffconcat version 1.0")), null);
  assert.equal(audioFormat(Buffer.from("Og")), null);
  assert.equal(audioFormat(Buffer.alloc(0)), null);
});

test("ffmpeg may only read its pipes, as the named format, for a limited time", () => {
  assert.deepEqual(inputArgs("gif", 120), ["-protocol_whitelist", "pipe", "-f", "gif", "-t", "120"]);
});

test("ffmpeg gets the path and none of the worker's secrets", () => {
  assert.deepEqual(Object.keys(ffmpegEnv()), ["PATH"]);
});
