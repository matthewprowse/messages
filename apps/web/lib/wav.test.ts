import { test } from "node:test";
import assert from "node:assert/strict";
import { joinParts } from "./wav";

/** A 16-bit mono WAV holding these samples. */
function wav(samples: number[], rate = 24000): Blob {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (at: number, s: string) => { for (let i = 0; i < 4; i++) out.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, "RIFF");
  out.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  ascii(36, "data");
  out.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => out.setInt16(44 + i * 2, s, true));
  return new Blob([out.buffer], { type: "audio/wav" });
}

test("parts join into one WAV with every sample in order", async () => {
  const joined = await joinParts([wav([1, 2]), wav([3]), wav([4, 5, 6])]);
  assert.ok(joined);
  const view = new DataView(await joined.arrayBuffer());
  assert.equal(view.getUint32(40, true), 12);
  assert.equal(view.getUint32(4, true), 36 + 12);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true)), [1, 2, 3, 4, 5, 6]);
});

test("parts in different formats, or not WAV at all, are not joined", async () => {
  assert.equal(await joinParts([wav([1], 24000), wav([2], 16000)]), null);
  assert.equal(await joinParts([wav([1]), new Blob(["not audio"])]), null);
  assert.equal(await joinParts([]), null);
});
