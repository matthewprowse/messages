// Builds the Download My Data zip in the browser with fflate's streaming Zip (pinned exactly in package.json). Entries are
// added one at a time and the compressed pieces are collected as they come, so a large export is never one giant buffer
// plus its copy. Text is deflated; files that are already compressed (photos, PDFs, video) are stored as they are.

import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

/** File types that gain nothing from deflate, so they are stored whole. */
const STORED = /\.(jpe?g|png|gif|webp|heic|avif|mp4|mov|m4a|mp3|pdf|zip|docx|xlsx|pptx)$/i;

export class ZipWriter {
  private readonly pieces: Uint8Array[] = [];
  private readonly zip: Zip;
  private failure: Error | null = null;
  private finished = false;
  bytes = 0;

  constructor() {
    this.zip = new Zip((error, chunk) => {
      if (error) this.failure = error;
      else {
        this.pieces.push(chunk);
        this.bytes += chunk.length;
      }
    });
  }

  /** Adds one file. `path` uses forward slashes and no leading slash. Throws if an earlier entry failed. */
  add(path: string, data: string | Uint8Array): void {
    if (this.finished) throw new Error("zip already finished");
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const entry = STORED.test(path) ? new ZipPassThrough(path) : new ZipDeflate(path, { level: 6 });
    this.zip.add(entry);
    entry.push(bytes, true);
    if (this.failure) throw this.failure;
  }

  /** Ends the archive and returns it as a file. */
  finish(): Blob {
    this.finished = true;
    this.zip.end();
    if (this.failure) throw this.failure;
    return new Blob(this.pieces as BlobPart[], { type: "application/zip" });
  }

  /** The finished archive's bytes, for tests. */
  async finishBytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.finish().arrayBuffer());
  }
}
