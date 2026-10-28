// Files for the LinkedIn helper. It reads them from disk, on the same machine, and only from under the temp
// folder, so each send gets a private folder (mode 0700) with the files in it (0600) that is removed
// afterwards, sent or not.

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutgoingAttachment } from "../send/compose";
import type { HelperAttachment } from "./helper";

/** How LinkedIn is told to take a file: photos and MP4 videos as such, everything else as a document. */
export function helperKind(contentType: string): HelperAttachment["kind"] {
  const type = contentType.toLowerCase();
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) return "image";
  return type === "video/mp4" ? "video" : "file";
}

export interface StagedFiles {
  files: HelperAttachment[];
  /** Deletes the folder. Never throws. */
  cleanup(): Promise<void>;
}

export const NO_FILES: StagedFiles = { files: [], cleanup: async () => undefined };

/** Writes the files to a new private folder under base, named by position so a file name is never a path. */
export async function stageFiles(files: OutgoingAttachment[], base = tmpdir()): Promise<StagedFiles> {
  const dir = await mkdtemp(join(base, "konva-linkedin-"));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => undefined);
  try {
    await chmod(dir, 0o700);
    const staged: HelperAttachment[] = [];
    for (const [i, f] of files.entries()) {
      const path = join(dir, String(i));
      await writeFile(path, f.content, { mode: 0o600 });
      staged.push({ path, name: f.filename, mime: f.contentType, kind: helperKind(f.contentType) });
    }
    return { files: staged, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

const UPLOAD_BASE_MS = 90_000;
const UPLOAD_PER_FILE_MS = 60_000;

/** How long to wait for the helper to upload and send this many files. */
export function sendTimeoutMs(files: number): number {
  return UPLOAD_BASE_MS + files * UPLOAD_PER_FILE_MS;
}
