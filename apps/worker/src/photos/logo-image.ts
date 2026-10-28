import sharp from "sharp";

// Turns a company's icon (PNG, JPEG, WebP, GIF, SVG or ICO, from its website, the App Store or anywhere
// else) into one tidy square picture for a round avatar, so every company's picture looks alike:
// - a mark on a plain colour, on a tile or disc of one colour, or on transparency is found, centred on
//   what is visible and scaled to fit a fixed safe circle however wide it is, on its own colour or on a
//   background it stands out from;
// - a picture with no plain background (a gradient app icon, a photo) fills the circle, unless detail
//   would reach the circle's edge, when it is drawn smaller inside it.
// Nothing touches or crosses the circle's edge. Icons too small to look sharp are turned down rather than
// blown up. Pure apart from sharp, so it can be tested.

/** The side of the stored picture, in pixels: sharp at 40px on a 3x screen and in the larger views. */
export const LOGO_SIZE = 256;
/**
 * A raster icon smaller than this (its shorter side) is never used: it would look blurred. A 48 pixel
 * icon's mark is drawn about 50 device pixels across in a 40px avatar on a 2x screen, so it stays sharp.
 */
export const MIN_SOURCE = 48;
/** The safe circle a mark is fitted inside, as a share of the avatar's width. */
const SAFE = 0.76;
/**
 * A round or rounded mark may grow this much past the size its box would get, since its corners are
 * empty: a disc fills more of the safe circle than a square, yet looks no larger.
 */
const ROUND_ALLOWANCE = 1.15;
/** A full-bleed picture keeps its detail inside this share of the circle's radius, or it is drawn smaller. */
const TILE_SAFE = 0.84;
const MAX_PIXELS = 4096 * 4096;
/** Two colours within this of each other (on every channel) count as the same. */
const SAME = 36;
const WHITE: Rgb = [255, 255, 255];
const DARK_BG: Rgb = [10, 10, 10];

export type Rgb = [number, number, number];
interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

export interface Logo {
  /** The finished PNG, LOGO_SIZE square, made to be shown in a circle. */
  png: Buffer;
  /**
   * How sharp the logo will look: the pixels its mark had, scaled so 160 means the mark was as large as it
   * is drawn here (160 pixels for a square mark). Larger is sharper; under about 40 looks soft.
   */
  quality: number;
  /** "mark": a mark set on a plain background; "tile": a picture filling the circle; "inset": one drawn smaller to keep its detail inside. */
  fit: "mark" | "tile" | "inset";
  /** The background colour, for a mark. */
  background: Rgb | null;
}

export interface FrameOptions {
  /** The brand's colour, used behind a white mark instead of near-black when the mark shows on it. */
  brand?: Rgb | null;
}

/** An icon's pixels as RGBA, whatever its format, or null when it cannot be read. */
export async function decodeIcon(bytes: Buffer): Promise<{ raw: Raw; vector: boolean } | null> {
  try {
    if (isIco(bytes)) {
      const raw = await decodeIco(bytes);
      return raw && { raw, vector: false };
    }
    const vector = isSvg(bytes);
    let image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" });
    if (vector) {
      // Drawn at about 512 pixels, whatever size the file says it is.
      const meta = await image.metadata();
      const side = Math.max(meta.width ?? 0, meta.height ?? 0);
      if (!side) return null;
      const density = Math.min(2400, Math.max(1, (72 * 512) / side));
      image = sharp(bytes, { density, limitInputPixels: MAX_PIXELS, failOn: "error" });
    }
    const { data, info } = await image.ensureAlpha().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) return null;
    return { raw: { data, width: info.width, height: info.height }, vector };
  } catch {
    return null;
  }
}

export const isSvg = (bytes: Buffer) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(bytes.subarray(0, 2048).toString("utf8"));
const isIco = (bytes: Buffer) => bytes.length > 6 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1 && bytes.readUInt16LE(4) > 0;

/** The largest picture in an ICO file: PNG inside, or a 32-bit or 24-bit bitmap. Others are too old and small to want. */
async function decodeIco(bytes: Buffer): Promise<Raw | null> {
  const count = bytes.readUInt16LE(4);
  let best: { size: number; offset: number; length: number } | null = null;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    if (at + 16 > bytes.length) break;
    const size = bytes[at] || 256;
    const length = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    if (offset + length > bytes.length) continue;
    if (!best || size > best.size) best = { size, offset, length };
  }
  if (!best) return null;
  const entry = bytes.subarray(best.offset, best.offset + best.length);
  if (entry.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    const { data, info } = await sharp(entry, { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }
  if (entry.length < 40) return null;
  const header = entry.readUInt32LE(0);
  const width = entry.readInt32LE(4);
  const height = Math.abs(entry.readInt32LE(8)) / 2; // the height counts the transparency mask too
  const bits = entry.readUInt16LE(14);
  if (width <= 0 || height <= 0 || width > 512 || height > 512 || ![1, 4, 8, 24, 32].includes(bits)) return null;
  const colours = bits <= 8 ? entry.readUInt32LE(32) || 1 << bits : 0;
  const palette = header;
  const pixels = palette + colours * 4;
  const stride = Math.ceil((width * bits) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const mask = pixels + stride * height;
  if (mask > entry.length) return null;
  const data = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = pixels + (height - 1 - y) * stride; // bottom-up
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let p: number;
      if (bits <= 8) {
        const index = (entry[row + ((x * bits) >> 3)] >> (8 - bits - ((x * bits) & 7))) & ((1 << bits) - 1);
        p = palette + index * 4;
      } else {
        p = row + x * (bits / 8);
      }
      data[o] = entry[p + 2];
      data[o + 1] = entry[p + 1];
      data[o + 2] = entry[p];
      data[o + 3] = bits === 32 ? entry[p + 3] : 255;
      if (bits === 32 && data[o + 3]) anyAlpha = true;
    }
  }
  // Bitmaps without an alpha channel, and 32-bit ones that leave it empty, take transparency from the mask.
  if (!anyAlpha) {
    if (mask + maskStride * height > entry.length) return null;
    for (let y = 0; y < height; y++) {
      const row = mask + (height - 1 - y) * maskStride;
      for (let x = 0; x < width; x++) {
        const hidden = (entry[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        data[(y * width + x) * 4 + 3] = hidden ? 0 : 255;
      }
    }
  }
  return { data, width, height };
}

const px = (raw: Raw, x: number, y: number) => (y * raw.width + x) * 4;
const same = (a: Rgb, b: Rgb, tolerance = SAME) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance && Math.abs(a[2] - b[2]) <= tolerance;
const rgbAt = (raw: Raw, o: number): Rgb => [raw.data[o], raw.data[o + 1], raw.data[o + 2]];

/** Relative luminance, 0 to 1, as WCAG defines it. */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** How far apart two colours are to the eye: 1 (the same) to 21 (black on white). */
export const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The colour most of these pixels share, when at least `share` of them do. */
function commonColour(colours: Rgb[], share: number): Rgb | null {
  if (colours.length === 0) return null;
  const middle = (i: 0 | 1 | 2) => [...colours].sort((a, b) => a[i] - b[i])[colours.length >> 1][i];
  const median: Rgb = [middle(0), middle(1), middle(2)];
  const matching = colours.filter((c) => same(c, median)).length;
  return matching / colours.length >= share ? median : null;
}

interface Box {
  left: number;
  top: number;
  right: number; // exclusive
  bottom: number; // exclusive
}
const boxWidth = (b: Box) => b.right - b.left;
const boxHeight = (b: Box) => b.bottom - b.top;

/**
 * The smallest box around the pixels `keep` picks, or null when it picks none. Rows and columns at its edges
 * with only a speck or two (JPEG noise, a stray pixel) are left out, so they do not shrink the mark.
 */
function boundsOf(raw: Raw, keep: (o: number) => boolean, within: Box = { left: 0, top: 0, right: raw.width, bottom: raw.height }): Box | null {
  const cols = new Uint32Array(boxWidth(within));
  const rows = new Uint32Array(boxHeight(within));
  let any = false;
  for (let y = within.top; y < within.bottom; y++) {
    for (let x = within.left; x < within.right; x++) {
      if (!keep(px(raw, x, y))) continue;
      cols[x - within.left]++;
      rows[y - within.top]++;
      any = true;
    }
  }
  if (!any) return null;
  const span = (counts: Uint32Array, across: number): [number, number] => {
    const first = counts.findIndex((n) => n > 0);
    const last = counts.findLastIndex((n) => n > 0);
    const floor = Math.floor(across * 0.004);
    let a = first, b = last;
    while (a < b && counts[a] <= floor) a++;
    while (b > a && counts[b] <= floor) b--;
    return counts[a] > floor ? [a, b] : [first, last];
  };
  const [left, right] = span(cols, rows.length);
  const [top, bottom] = span(rows, cols.length);
  return { left: within.left + left, top: within.top + top, right: within.left + right + 1, bottom: within.top + bottom + 1 };
}

/** Pixels on the outer edge of a box (opaque ones only, unless asked), and how many were looked at. */
function ringColours(raw: Raw, box: Box, opaqueOnly = true): { colours: Rgb[]; total: number } {
  const colours: Rgb[] = [];
  let total = 0;
  const l = box.left, t = box.top, r = box.right - 1, b = box.bottom - 1;
  if (r <= l || b <= t) return { colours, total };
  const step = Math.max(1, Math.floor(Math.max(r - l, b - t) / 128));
  const visit = (x: number, y: number) => {
    total++;
    const o = px(raw, x, y);
    if (!opaqueOnly || raw.data[o + 3] > 200) colours.push(rgbAt(raw, o));
  };
  for (let x = l; x <= r; x += step) { visit(x, t); visit(x, b); }
  for (let y = t + step; y < b; y += step) { visit(l, y); visit(r, y); }
  return { colours, total };
}

/**
 * The company's icon as a finished avatar picture, or null when it is too small, blank, or unreadable.
 * Three kinds of icon come in, and each is framed its own way:
 * - a mark on a plain colour, or on a tile or disc of one colour (most app icons): the mark is found and
 *   fitted to the safe circle on that colour, so the avatar is a circle of the brand colour;
 * - a mark on a transparent or white background (most favicons and logo files): fitted to the safe circle
 *   on white, or on a background it shows on when the mark itself is white;
 * - a picture that fills its whole square with no plain background (a gradient app icon, a photo): it
 *   fills the circle.
 */
export async function frameLogo(bytes: Buffer, options: FrameOptions = {}): Promise<Logo | null> {
  const decoded = await decodeIcon(bytes);
  if (!decoded) return null;
  const { raw, vector } = decoded;
  if (!vector && Math.min(raw.width, raw.height) < MIN_SOURCE) return null;

  const whole: Box = { left: 0, top: 0, right: raw.width, bottom: raw.height };
  const border = ringColours(raw, whole, false);
  const opaqueBorder = ringColours(raw, whole);
  const transparentEdge = (border.total - opaqueBorder.colours.length) / border.total;

  let clear = 0;
  for (let o = 3; o < raw.data.length; o += 4) if (raw.data[o] <= 16) clear++;
  const transparent = transparentEdge >= 0.1 || clear / (raw.width * raw.height) >= 0.01;

  let background: Rgb | null = null; // null: transparent
  let area: Box;
  if (!transparent) {
    // Most of the edge one colour: a mark on a plain background, perhaps drawn out to the edge (a
    // wordmark app icon). Otherwise a gradient or photo to the edges.
    background = commonColour(opaqueBorder.colours, 0.85) ?? commonColour(opaqueBorder.colours, 0.5);
    if (!background) return tile(raw, whole, vector);
    area = whole;
  } else {
    const visible = boundsOf(raw, (o) => raw.data[o + 3] > 16);
    if (!visible) return null; // fully transparent
    area = visible;
  }

  // What stands out from the background.
  const isMark = (o: number) => (background ? raw.data[o + 3] > 200 && !same(rgbAt(raw, o), background, SAME + 8) : raw.data[o + 3] > 16);
  const mark = boundsOf(raw, isMark, area);
  if (!mark) return null; // a plain square of colour, with nothing on it
  // Something other than the background reaches all four edges: a picture after all (a gentle gradient).
  if (background && boxWidth(mark) >= 0.97 * boxWidth(area) && boxHeight(mark) >= 0.97 * boxHeight(area)) return tile(raw, area, vector);

  // Is the mark itself a tile or disc of one colour with a smaller mark on it (an app icon with rounded
  // corners, or one set on white)? Then that colour is the background, and the smaller mark is the logo.
  const w = boxWidth(mark), h = boxHeight(mark);
  const squareish = Math.abs(w - h) <= Math.max(2, 0.08 * Math.max(w, h));
  if (squareish && Math.min(w, h) >= 24) {
    let covered = 0;
    for (let y = mark.top; y < mark.bottom; y++) for (let x = mark.left; x < mark.right; x++) if (isMark(px(raw, x, y))) covered++;
    if (covered / (w * h) >= 0.74) {
      const tileColour = commonColour(circleColours(raw, mark), 0.75);
      if (tileColour) {
        const band = Math.max(1, Math.round(0.03 * Math.min(w, h)));
        const inner: Box = { left: mark.left + band, top: mark.top + band, right: mark.right - band, bottom: mark.bottom - band };
        const onTileColour = (o: number) => raw.data[o + 3] > 200 && !same(rgbAt(raw, o), tileColour, SAME + 8);
        const onTile = boundsOf(raw, onTileColour, inner);
        if (onTile) return place(raw, onTile, tileColour, onTileColour);
      }
      // A tile or disc of many colours (a gradient app icon) with rounded corners fills the circle: the
      // circle shows only the tile. A square logo with sharp corners (four coloured squares) does not.
      const corner = Math.max(1, Math.round(0.03 * Math.min(w, h)));
      const corners = [[mark.left + corner, mark.top + corner], [mark.right - 1 - corner, mark.top + corner], [mark.left + corner, mark.bottom - 1 - corner], [mark.right - 1 - corner, mark.bottom - 1 - corner]];
      if (!tileColour && corners.every(([x, y]) => !isMark(px(raw, x, y)))) {
        const filled = await tile(raw, mark, vector);
        if (filled) return filled;
      }
    }
  }
  return place(raw, mark, background ?? markBackground(raw, mark, options.brand ?? null), isMark);
}

/** Opaque pixels on a circle just inside a tile's edge, where a rounded square and a disc are both still solid. */
function circleColours(raw: Raw, box: Box): Rgb[] {
  const cx = (box.left + box.right - 1) / 2, cy = (box.top + box.bottom - 1) / 2;
  const radius = 0.44 * Math.min(boxWidth(box), boxHeight(box));
  const colours: Rgb[] = [];
  for (let i = 0; i < 180; i++) {
    const angle = (i / 180) * 2 * Math.PI;
    const o = px(raw, Math.round(cx + radius * Math.cos(angle)), Math.round(cy + radius * Math.sin(angle)));
    if (raw.data[o + 3] > 200) colours.push(rgbAt(raw, o));
  }
  return colours;
}

/**
 * White behind a mark on transparency, unless much of the mark is white or nearly (it would disappear):
 * then the brand's colour when the mark shows on it, or near-black.
 */
function markBackground(raw: Raw, mark: Box, brand: Rgb | null): Rgb {
  let ink = 0, light = 0;
  const lightSum = [0, 0, 0];
  const step = Math.max(1, Math.floor(Math.max(boxWidth(mark), boxHeight(mark)) / 200));
  for (let y = mark.top; y < mark.bottom; y += step) {
    for (let x = mark.left; x < mark.right; x += step) {
      const o = px(raw, x, y);
      if (raw.data[o + 3] < 128) continue;
      ink++;
      const c = rgbAt(raw, o);
      if (contrast(c, WHITE) < 1.6) {
        light++;
        for (const i of [0, 1, 2]) lightSum[i] += c[i];
      }
    }
  }
  if (ink === 0 || light / ink < 0.35) return WHITE;
  const lightColour = lightSum.map((v) => v / light) as Rgb;
  return brand && contrast(brand, lightColour) >= 3 ? brand : DARK_BG;
}

/**
 * The mark in `mark` set on a square of `background`, centred on the box around it and scaled so it fits
 * the safe circle: by the farthest pixel of the mark from the centre, so a wide wordmark and a square
 * mark both stay clear of the edge. A round mark may grow a little past what its box allows.
 */
async function place(raw: Raw, mark: Box, background: Rgb, ink: (o: number) => boolean): Promise<Logo> {
  const markWidth = boxWidth(mark), markHeight = boxHeight(mark);
  const cx = (mark.left + mark.right) / 2, cy = (mark.top + mark.bottom) / 2;
  let reach = 0;
  const step = Math.max(1, Math.floor(Math.max(markWidth, markHeight) / 256));
  for (let y = mark.top; y < mark.bottom; y += step) {
    for (let x = mark.left; x < mark.right; x += step) {
      if (ink(px(raw, x, y))) reach = Math.max(reach, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.71);
    }
  }
  const radius = (SAFE * LOGO_SIZE) / 2;
  const boxReach = Math.hypot(markWidth, markHeight) / 2;
  const scale = Math.min(radius / Math.max(reach, 1), (radius / boxReach) * ROUND_ALLOWANCE);
  const targetWidth = Math.max(1, Math.round(markWidth * scale));
  const targetHeight = Math.max(1, Math.round(markHeight * scale));
  const colour = { r: background[0], g: background[1], b: background[2] };

  const cut = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .extract({ left: mark.left, top: mark.top, width: markWidth, height: markHeight })
    .resize({ width: targetWidth, height: targetHeight, fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const png = await sharp({ create: { width: LOGO_SIZE, height: LOGO_SIZE, channels: 4, background: { ...colour, alpha: 1 } } })
    .composite([{ input: cut, left: Math.round((LOGO_SIZE - targetWidth) / 2), top: Math.round((LOGO_SIZE - targetHeight) / 2) }])
    .flatten({ background: colour })
    .png({ compressionLevel: 9 })
    .toBuffer();
  // How many source pixels each displayed pixel of the mark has.
  return { png, quality: Math.round(160 / scale), fit: "mark", background };
}

/**
 * A picture with no plain background, cropped square to fill the circle. When it has sharp detail near the
 * circle's edge (a mark drawn to the edge of its tile), it is drawn smaller, inside a circle of its own
 * edge colour, so the detail stays clear of the edge.
 */
async function tile(raw: Raw, area: Box, vector: boolean): Promise<Logo | null> {
  const side = Math.min(boxWidth(area), boxHeight(area));
  if (!vector && side < MIN_SOURCE) return null;
  const square = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .extract({ left: area.left + Math.floor((boxWidth(area) - side) / 2), top: area.top + Math.floor((boxHeight(area) - side) / 2), width: side, height: side })
    .resize(LOGO_SIZE, LOGO_SIZE, { kernel: "lanczos3" })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
  const quality = Math.round((side / LOGO_SIZE) * 160);
  const { data } = await sharp(square).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels: Raw = { data, width: LOGO_SIZE, height: LOGO_SIZE };
  const edge = edgeDetail(pixels);
  const crossing = edge.edges > 0.004 * edge.ring && edge.slices < 30;
  if (!crossing) return { png: await sharp(square).png({ compressionLevel: 9 }).toBuffer(), quality, fit: "tile", background: null };

  const inner = Math.round(LOGO_SIZE * TILE_SAFE);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><circle cx="${inner / 2}" cy="${inner / 2}" r="${inner / 2}" fill="#fff"/></svg>`);
  const smaller = await sharp(square).resize(inner, inner, { kernel: "lanczos3" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const colour = { r: edge.colour[0], g: edge.colour[1], b: edge.colour[2] };
  const png = await sharp({ create: { width: LOGO_SIZE, height: LOGO_SIZE, channels: 4, background: { ...colour, alpha: 1 } } })
    .composite([{ input: smaller, left: Math.round((LOGO_SIZE - inner) / 2), top: Math.round((LOGO_SIZE - inner) / 2) }])
    .flatten({ background: colour })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { png, quality: Math.round(quality * TILE_SAFE), fit: "inset", background: edge.colour };
}

/**
 * Sharp detail in the ring between TILE_SAFE of the circle's radius and its edge: how many pixels there
 * change brightness sharply, in how many of 36 slices of the circle they lie, and the ring's average
 * colour. A smooth gradient has none; a mark or text drawn to the edge has some, in a few slices; a tile
 * or disc's own round border has some in every slice, and is not a mark reaching the edge.
 */
function edgeDetail(raw: Raw): { edges: number; ring: number; slices: number; colour: Rgb } {
  const half = LOGO_SIZE / 2;
  const light = (x: number, y: number) => {
    const o = px(raw, x, y);
    return 0.2126 * raw.data[o] + 0.7152 * raw.data[o + 1] + 0.0722 * raw.data[o + 2];
  };
  let ring = 0, edges = 0;
  const slices = new Set<number>();
  const sum = [0, 0, 0];
  for (let y = 1; y < LOGO_SIZE - 1; y++) {
    for (let x = 1; x < LOGO_SIZE - 1; x++) {
      const dx = x + 0.5 - half, dy = y + 0.5 - half;
      const r = Math.hypot(dx, dy);
      if (r < TILE_SAFE * half || r > half - 2) continue;
      ring++;
      const o = px(raw, x, y);
      for (const i of [0, 1, 2]) sum[i] += raw.data[o + i];
      const change = Math.abs(light(x + 1, y) - light(x - 1, y)) + Math.abs(light(x, y + 1) - light(x, y - 1));
      if (change <= 30) continue;
      edges++;
      slices.add(Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 36) % 36);
    }
  }
  return { edges, ring, slices: slices.size, colour: sum.map((v) => Math.round(v / Math.max(1, ring))) as Rgb };
}
