// A small picture of a photo for grid tiles: 256 px on the long side, JPEG at quality 70 (about 15 KB), made with sharp
// when a photo is saved (file-store.ts) and by the lazy backfill (missing-files.ts). The bytes are sealed by the caller,
// so the browser can show a tile from a few KB instead of the whole encrypted photo.

import sharp from "sharp";

/** The long side of a thumbnail, in pixels. The web tile is 96 px, so this is sharp up to 2.5x screens. */
export const THUMB_SIZE = 256;
const THUMB_QUALITY = 70;
/** Same bound as photos/logo-image.ts: 16.7 MP, so one hostile image cannot take the worker's memory. */
const MAX_PIXELS = 4096 * 4096;
/** At most this many are decoded at once; a full-size photo decodes to tens of MB. */
const PARALLEL = 2;
/** Types sharp reads and a browser can show; SVG is left out (it is not a photo) and HEIC is tried and may fail. */
const THUMBABLE = /^image\/(png|jpe?g|webp|gif|avif|heic|heif|tiff)$/i;

let running = 0;
const queue: (() => void)[] = [];

/** True for a type worth a thumbnail. An unknown type (null) is tried, since sharp sniffs the bytes itself. */
export function canThumbnail(mimeType: string | null | undefined): boolean {
  const type = (mimeType ?? "").split(";")[0].trim();
  return type === "" || THUMBABLE.test(type);
}

/** The thumbnail JPEG of an image, or null when it cannot be read (corrupt, too many pixels, a type sharp lacks). */
export async function makeThumbnail(bytes: Buffer): Promise<Buffer | null> {
  if (running >= PARALLEL) await new Promise<void>((resolve) => queue.push(resolve));
  running++;
  try {
    return await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate() // upright by the photo's own orientation; the tag is dropped with the other metadata
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }) // transparency has no JPEG form
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  } finally {
    running--;
    queue.shift()?.();
  }
}

/** Where a file's thumbnail sits in the bucket, beside the file. */
export const thumbPathFor = (storagePath: string) => `${storagePath}.thumb`;
