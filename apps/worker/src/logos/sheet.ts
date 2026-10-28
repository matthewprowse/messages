import sharp, { type OverlayOptions } from "sharp";

// The picture the judge looks at: every framed candidate cut to the circle it would be shown in, numbered
// from 1, on a grey that white logos stand out from.

const CELL = 200;
const AVATAR = 160;
const LABEL = 40;
const COLUMNS = 4;
const SHEET_BG = { r: 228, g: 228, b: 231 };

/** A framed logo cut to its circle, `size` pixels across, with the app's faint outline. */
export async function circleAvatar(png: Buffer, size: number, outline = "rgba(0,0,0,0.1)"): Promise<Buffer> {
  const r = size / 2;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`);
  const ring = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r - 0.5}" fill="none" stroke="${outline}" stroke-width="1"/></svg>`);
  return sharp(png)
    .resize(size, size, { kernel: "lanczos3" })
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }, { input: ring }])
    .png()
    .toBuffer();
}

/** The judge's sheet: candidate n is the nth logo, drawn as a 160px circle under its number. */
export async function judgeSheet(logos: Buffer[]): Promise<Buffer> {
  const columns = Math.min(COLUMNS, Math.max(1, logos.length));
  const rows = Math.ceil(logos.length / columns);
  const width = columns * CELL;
  const height = rows * (CELL + LABEL);
  const parts: OverlayOptions[] = [];
  const labels: string[] = [];
  for (const [i, logo] of logos.entries()) {
    const x = (i % columns) * CELL;
    const y = Math.floor(i / columns) * (CELL + LABEL);
    labels.push(`<text x="${x + CELL / 2}" y="${y + 32}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="#18181b">${i + 1}</text>`);
    parts.push({ input: await circleAvatar(logo, AVATAR, "rgba(0,0,0,0.18)"), left: x + (CELL - AVATAR) / 2, top: y + LABEL + (CELL - AVATAR) / 2 - 10 });
  }
  parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels.join("")}</svg>`), left: 0, top: 0 });
  return sharp({ create: { width, height, channels: 3, background: SHEET_BG } }).composite(parts).png({ compressionLevel: 9 }).toBuffer();
}
