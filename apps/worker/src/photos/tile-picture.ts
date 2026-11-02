// One entry point for "the small picture of a stored file": a photo through sharp, a PDF's first page through pdf.js.
// file-store.ts (at save) and missing-files.ts (the backfill) both call it, so the two cannot drift apart.

import { makePdfThumbnail } from "./pdf-thumbnail";
import { canThumbnail, makeThumbnail } from "./thumbnail";

/** True for a kind and type that can have a tile picture: photos sharp reads, and PDFs. */
export function canTilePicture(kind: string, mimeType: string | null | undefined): boolean {
  if (kind === "pdf") return true;
  return kind === "image" && canThumbnail(mimeType);
}

/** The tile picture (a JPEG) of a file's bytes, or null when there is none to make. */
export function makeTilePicture(kind: string, bytes: Buffer): Promise<Buffer | null> {
  return kind === "pdf" ? makePdfThumbnail(bytes) : makeThumbnail(bytes);
}
