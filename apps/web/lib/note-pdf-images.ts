import type { Picture } from "./pdf-writer";

// A picture in a note as the JPEG a PDF can hold, shrunk to what a page can show so a big photo does not make a big,
// slow file. Needs a browser: it draws the picture on a canvas.

const MAX_SIDE = 1400;

export async function jpegPicture(url: string): Promise<Picture | null> {
  const blob = await fetch(url).then((r) => (r.ok ? r.blob() : null));
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!jpeg) return null;
  return { bytes: new Uint8Array(await jpeg.arrayBuffer()), width, height };
}
