// A voice note recorded in the app arrives as whatever the browser records (WebM or Ogg Opus in Chrome
// and Firefox, MP4 AAC in older Safari). WhatsApp only shows a voice note for mono Opus in an Ogg file,
// with its length and the 64-bar waveform drawn under it, so ffmpeg converts each one before it goes.
// ffmpeg reads and writes through pipes, so the audio never touches the disk.

import { spawn } from "node:child_process";
import type { OutgoingAttachment } from "../send/compose";
import { log } from "../log";
import { audioFormat, ffmpegEnv, inputArgs } from "./ffmpeg-input";
import type { WhatsAppFile } from "./outgoing";

/** Samples a second in the copy the length and waveform are read from. */
const PCM_RATE = 8000;
/** Bars in the waveform WhatsApp draws. */
const BARS = 64;
/** Longer than any voice note takes to convert. */
const CONVERT_MS = 60_000;
/** Seconds of a recording that are converted; a longer one is cut here. */
const VOICE_MAX_SECONDS = 30 * 60;
/** The largest Ogg file written: 30 minutes at 32 kbit/s is about 7 MB. */
const OGG_MAX_BYTES = 16 * 1024 * 1024;

const FAILED = "The voice note could not be prepared, so nothing was sent. Try recording it again.";

/**
 * The waveform WhatsApp draws: the loudness of each of 64 equal slices, 0 to 100, the loudest at 100.
 * Silence is all zeros. Pure, so it can be unit tested.
 */
export function waveform(pcm: Int16Array, bars = BARS): Uint8Array {
  const out = new Uint8Array(bars);
  if (pcm.length === 0) return out;
  const levels = Array.from({ length: bars }, (_, i) => {
    const start = Math.floor((i * pcm.length) / bars);
    const end = Math.max(start + 1, Math.floor(((i + 1) * pcm.length) / bars));
    let sum = 0;
    for (let j = start; j < end && j < pcm.length; j++) sum += Math.abs(pcm[j]);
    return sum / (end - start);
  });
  const loudest = Math.max(...levels);
  if (loudest > 0) levels.forEach((level, i) => { out[i] = Math.round((level / loudest) * 100); });
  return out;
}

/** The voice note's length in whole seconds, never 0 for a note that has any sound. */
export function seconds(samples: number, rate = PCM_RATE): number {
  return samples > 0 ? Math.max(1, Math.round(samples / rate)) : 0;
}

/**
 * Converts one recording: the Ogg Opus file, plus a quiet 8 kHz copy the length and waveform come from. Throws with
 * code NOT_AUDIO, without running ffmpeg, when the bytes are not an Ogg, WebM or MP4 recording.
 */
export function convert(input: Buffer): Promise<{ ogg: Buffer; pcm: Int16Array }> {
  const format = audioFormat(input);
  if (!format) return Promise.reject(Object.assign(new Error("not a recording"), { code: "NOT_AUDIO" }));
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        ...inputArgs(format, VOICE_MAX_SECONDS), "-i", "pipe:0",
        "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", "-fs", String(OGG_MAX_BYTES), "-f", "ogg", "pipe:1",
        "-map", "0:a:0", "-ac", "1", "-ar", String(PCM_RATE), "-f", "s16le", "pipe:3",
      ],
      { stdio: ["pipe", "pipe", "pipe", "pipe"], env: ffmpegEnv() },
    );
    const ogg: Buffer[] = [];
    const pcm: Buffer[] = [];
    let errors = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), CONVERT_MS);
    child.stdout!.on("data", (d: Buffer) => ogg.push(d));
    (child.stdio[3] as NodeJS.ReadableStream).on("data", (d: Buffer) => pcm.push(d));
    child.stderr!.on("data", (d: Buffer) => { errors = (errors + d.toString()).slice(-500); });
    child.stdin!.on("error", () => undefined); // ffmpeg stopping early closes the pipe; the exit code says why
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(Object.assign(new Error(`ffmpeg exited ${code ?? signal}: ${errors.trim()}`), { code: signal === "SIGKILL" ? "TIMEOUT" : "FFMPEG_FAILED" }));
        return;
      }
      const raw = Buffer.concat(pcm);
      // Copied so the samples start on an even byte, as Int16Array needs.
      const samples = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 2)));
      resolve({ ogg: Buffer.concat(ogg), pcm: samples });
    });
    child.stdin!.end(input);
  });
}

/**
 * The files of a reply ready for WhatsApp: each voice note converted, the rest as they are. Returns the
 * reason to fail the row with when a voice note cannot be converted or has no sound.
 */
export async function prepareVoiceNotes(files: OutgoingAttachment[], context: Record<string, unknown>): Promise<WhatsAppFile[] | { error: string }> {
  if (!files.some((f) => f.voiceNote)) return files;
  const ready: WhatsAppFile[] = [];
  // One at a time: each holds the audio in memory a few times over.
  for (const f of files) {
    if (!f.voiceNote) { ready.push(f); continue; }
    try {
      const { ogg, pcm } = await convert(f.content);
      const length = seconds(pcm.length);
      if (ogg.length === 0 || length === 0) return { error: "The voice note is empty, so nothing was sent. Try recording it again." };
      ready.push({ filename: "Voice Note.ogg", contentType: "audio/ogg", content: ogg, voice: { seconds: length, waveform: waveform(pcm) } });
    } catch (err) {
      const code = (err as { code?: string }).code;
      log.warn("whatsapp voice note conversion failed", { ...context, code: code === "ENOENT" ? "FFMPEG_MISSING" : code });
      return { error: FAILED };
    }
  }
  return ready;
}
