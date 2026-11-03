// A GIF sent on WhatsApp is not a GIF file: WhatsApp plays an MP4 with no sound on a loop, marked as a GIF. So each .gif
// in a reply is converted with ffmpeg before it goes. The GIF comes in through a pipe; the MP4 is written to a private
// temporary folder, as an MP4 that phones play at once needs its index at the front, which a pipe cannot give, and the
// folder is removed as soon as the file is read.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log } from "../log";
import type { WhatsAppFile } from "./outgoing";

/** Longer than any GIF takes to convert. */
const CONVERT_MS = 60_000;

const FAILED = "The GIF could not be prepared, so nothing was sent. Try another one.";

/** True for a file that should go as a WhatsApp GIF. */
export const isGif = (f: Pick<WhatsAppFile, "contentType">) => f.contentType.toLowerCase() === "image/gif";

/** The MP4 name WhatsApp sees, from the GIF's. */
export function gifName(filename: string): string {
  return `${filename.replace(/\.gif$/i, "") || "GIF"}.mp4`;
}

/**
 * The ffmpeg arguments: H.264 in yuv420p (what every phone plays), even sides (H.264 needs them), no sound, and the index
 * at the front. Pure, so it can be unit tested.
 */
export function gifArgs(out: string): string[] {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-i", "pipe:0",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-movflags", "+faststart", "-f", "mp4", out,
  ];
}

export async function convertGif(input: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "gif-"));
  const out = join(dir, "out.mp4");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", gifArgs(out), { stdio: ["pipe", "ignore", "pipe"] });
      let errors = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), CONVERT_MS);
      child.stderr!.on("data", (d: Buffer) => { errors = (errors + d.toString()).slice(-500); });
      child.stdin!.on("error", () => undefined); // ffmpeg stopping early closes the pipe; the exit code says why
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(Object.assign(new Error(`ffmpeg exited ${code ?? signal}: ${errors.trim()}`), { code: signal === "SIGKILL" ? "TIMEOUT" : "FFMPEG_FAILED" }));
      });
      child.stdin!.end(input);
    });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The files of a reply with each GIF converted to a looping MP4, the rest as they are. Returns the reason to fail the row with when one cannot be. */
export async function prepareGifs(files: WhatsAppFile[], context: Record<string, unknown>): Promise<WhatsAppFile[] | { error: string }> {
  if (!files.some(isGif)) return files;
  const ready: WhatsAppFile[] = [];
  for (const f of files) {
    if (!isGif(f)) { ready.push(f); continue; }
    try {
      const mp4 = await convertGif(f.content);
      if (mp4.length === 0) return { error: FAILED };
      ready.push({ ...f, filename: gifName(f.filename), contentType: "video/mp4", content: mp4, gif: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      log.warn("whatsapp gif conversion failed", { ...context, code: code === "ENOENT" ? "FFMPEG_MISSING" : code });
      return { error: FAILED };
    }
  }
  return ready;
}
