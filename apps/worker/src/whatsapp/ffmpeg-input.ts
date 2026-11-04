// What ffmpeg is allowed to do with a file someone uploaded, for the GIF (./gif.ts) and voice note (./voice-note.ts)
// conversions. Pure: no processes. The file's type comes from its first bytes, never from the row's mime_type or
// voice_note flag (both are written by the browser), and ffmpeg is told that type, may only read its pipes, and gets
// none of the worker's secrets in its environment.

/** The environment ffmpeg runs with: enough to find it, and nothing else (no service role or key wrapping keys). */
export function ffmpegEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin" };
}

/**
 * The input options that go before "-i pipe:0": only pipes may be opened (no files, no network, no playlists pulling in
 * other inputs), the demuxer is named rather than guessed, and at most `seconds` of input are read.
 */
export function inputArgs(format: string, seconds: number): string[] {
  return ["-protocol_whitelist", "pipe", "-f", format, "-t", String(seconds)];
}

/** True when the bytes start like a GIF file ("GIF87a" or "GIF89a"). */
export function isGifBytes(b: Uint8Array): boolean {
  return /^GIF8[79]a$/.test(Buffer.from(b.subarray(0, 6)).toString("latin1"));
}

/**
 * The ffmpeg demuxer for a browser recording, from its first bytes: Ogg (Firefox), WebM (Chrome) or MP4 (Safari).
 * Null for anything else, which is not converted.
 */
export function audioFormat(b: Uint8Array): "ogg" | "matroska" | "mov" | null {
  const head = Buffer.from(b.subarray(0, 12));
  if (head.length >= 4 && head.toString("latin1", 0, 4) === "OggS") return "ogg";
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return "matroska"; // EBML header, which WebM uses
  if (head.length >= 8 && head.toString("latin1", 4, 8) === "ftyp") return "mov";
  return null;
}
