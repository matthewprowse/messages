// Tests for whatsapp/voice-note.ts: waveform and length maths, pass-through of non-voice files, and (when
// ffmpeg is installed) conversion of browser recordings to mono Ogg Opus.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { convert, prepareVoiceNotes, seconds, waveform } from "./voice-note";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** A tone made by ffmpeg in the format a browser records, for the conversion tests. */
function recording(format: "webm" | "mp4", length = 3): Buffer {
  const codec = format === "webm" ? ["-c:a", "libopus"] : ["-c:a", "aac", "-movflags", "frag_keyframe+empty_moov"];
  const out = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${length}`, "-ac", "2", ...codec, "-f", format, "pipe:1"], { maxBuffer: 10 * 1024 * 1024 });
  assert.equal(out.status, 0, out.stderr.toString());
  return out.stdout;
}

test("the waveform has 64 bars from 0 to 100, the loudest at 100", () => {
  const pcm = new Int16Array(6400);
  for (let i = 3200; i < 6400; i++) pcm[i] = i % 2 ? 10000 : -10000; // silent, then loud
  const bars = waveform(pcm);
  assert.equal(bars.length, 64);
  assert.equal(bars[0], 0);
  assert.equal(bars[63], 100);
});

test("silence and nothing draw a flat waveform", () => {
  assert.deepEqual([...waveform(new Int16Array(100))], new Array(64).fill(0));
  assert.deepEqual([...waveform(new Int16Array(0))], new Array(64).fill(0));
  assert.equal(waveform(new Int16Array(10)).length, 64); // shorter than 64 samples
});

test("the length is in whole seconds, at least 1 for any sound", () => {
  assert.equal(seconds(0), 0);
  assert.equal(seconds(100), 1);
  assert.equal(seconds(8000 * 7.4), 7);
  assert.equal(seconds(8000 * 7.6), 8);
});

test("files that are not voice notes pass through untouched", async () => {
  const files = [{ filename: "a.mp3", contentType: "audio/mpeg", content: Buffer.from("x") }];
  assert.equal(await prepareVoiceNotes(files, {}), files);
});

test("a WebM recording becomes mono Ogg Opus with its length and waveform", { skip: !hasFfmpeg }, async () => {
  const out = await prepareVoiceNotes([{ filename: "Voice Note.webm", contentType: "audio/webm", content: recording("webm"), voiceNote: true }], {});
  assert.ok(Array.isArray(out));
  const [note] = out;
  assert.equal(note.contentType, "audio/ogg");
  assert.equal(note.content.subarray(0, 4).toString(), "OggS");
  assert.ok(note.content.includes(Buffer.from("OpusHead")));
  assert.equal(note.content[note.content.indexOf(Buffer.from("OpusHead")) + 9], 1); // one channel
  assert.equal(note.voice?.seconds, 3);
  assert.equal(note.voice?.waveform.length, 64);
});

test("an MP4 recording from Safari converts too", { skip: !hasFfmpeg }, async () => {
  const { ogg, pcm } = await convert(recording("mp4", 2));
  assert.equal(ogg.subarray(0, 4).toString(), "OggS");
  assert.equal(seconds(pcm.length), 2);
});

test("something that is not audio fails the row with a reason", { skip: !hasFfmpeg }, async () => {
  const out = await prepareVoiceNotes([{ filename: "Voice Note.webm", contentType: "audio/webm", content: Buffer.from("not audio at all"), voiceNote: true }], {});
  assert.ok("error" in out && /could not be prepared/.test(out.error));
});
