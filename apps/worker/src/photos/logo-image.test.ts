import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { decodeIcon, frameLogo, LOGO_SIZE } from "./logo-image";

// Icons drawn here as SVG and turned into PNG, so each test says what it draws.
const png = (size: number, body: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${body}</svg>`)).png().toBuffer();

/** The colour at a point of a framed logo, and the box around everything that is not its background. */
async function look(bytes: Buffer) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, LOGO_SIZE);
  assert.equal(info.height, LOGO_SIZE);
  const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3)];
  const bg = at(0, 0);
  let left = Infinity, right = -1, top = Infinity, bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const c = at(x, y);
      if (Math.max(...c.map((v, i) => Math.abs(v - bg[i]))) < 60) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return { bg, at, box: { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 } };
}

test("a mark on transparency is set on white, at the same size whatever padding it came with", async () => {
  for (const [x, side] of [[40, 20], [5, 90]]) {
    const logo = await frameLogo(await png(128, `<rect x="${x}" y="${x}" width="${side}" height="${side}" fill="#00c"/>`));
    assert.ok(logo);
    const p = await look(logo.png);
    assert.deepEqual(p.bg, [255, 255, 255]);
    // A square mark's corners touch the safe circle (0.76 of the picture across): about 54% wide, in the middle.
    assert.ok(Math.abs(p.box.width - 138) <= 4, `width ${p.box.width}`);
    assert.ok(Math.abs(p.box.left - (LOGO_SIZE - p.box.width) / 2) <= 2);
  }
  // An opaque square of one colour has nothing on it: no logo.
  assert.equal(await frameLogo(await png(128, `<rect width="100" height="100" fill="#d00"/>`)), null);
});

test("a mark on a plain colour, or a rounded tile of one colour, keeps that colour as its background", async () => {
  const onColour = await frameLogo(await png(180, `<rect width="100" height="100" fill="#fc4c02"/><rect x="45" y="30" width="10" height="40" fill="#fff"/>`));
  assert.ok(onColour);
  const a = await look(onColour.png);
  assert.deepEqual(a.bg, [252, 76, 2]);
  assert.ok(Math.abs(a.box.height - Math.round((0.76 * LOGO_SIZE) / Math.sqrt(1 / 16 + 1))) <= 4, `height ${a.box.height}`);

  const tile = await frameLogo(await png(64, `<rect width="100" height="100" rx="20" fill="#0a66c2"/><rect x="30" y="30" width="40" height="40" fill="#fff"/>`));
  assert.ok(tile);
  const b = await look(tile.png);
  assert.deepEqual(b.bg, [10, 102, 194]);
  assert.ok(Math.abs(b.box.width - 138) <= 4, `width ${b.box.width}`);
});

/** The farthest pixel that differs from the corner colour, from the centre, in pixels. */
async function reach(bytes: Buffer) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = [...data.subarray(0, 3)];
  let far = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * 4;
      if (Math.max(...bg.map((v, i) => Math.abs(v - data[o + i]))) < 60) continue;
      far = Math.max(far, Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2));
    }
  }
  return far;
}

test("wide, tall and round marks all stay inside the safe circle, centred on what is visible", async () => {
  const safe = (0.76 * LOGO_SIZE) / 2 + 2;
  for (const body of [
    `<rect x="2" y="44" width="96" height="12" fill="#e60023"/>`, // a wide wordmark
    `<rect x="44" y="2" width="12" height="96" fill="#e60023"/>`, // a tall shield
    `<rect x="0" y="0" width="70" height="40" fill="#e60023"/>`, // off-centre in its file
  ]) {
    const logo = await frameLogo(await png(200, body));
    assert.ok(logo);
    assert.ok((await reach(logo.png)) <= safe, body);
    const { box } = await look(logo.png);
    assert.ok(Math.abs(box.left + box.right - (LOGO_SIZE - 1)) <= 3 && Math.abs(box.top + box.bottom - (LOGO_SIZE - 1)) <= 3, `centred ${JSON.stringify(box)}`);
  }
  // A disc may be drawn a little larger than a square, as its corners are empty, and still fits.
  const disc = await look((await frameLogo(await png(200, `<circle cx="50" cy="50" r="40" fill="#e60023"/>`)))!.png);
  const square = await look((await frameLogo(await png(200, `<rect x="10" y="10" width="80" height="80" fill="#e60023"/>`)))!.png);
  assert.ok(disc.box.width > square.box.width + 10, `${disc.box.width} vs ${square.box.width}`);
  assert.ok(disc.box.width <= 0.76 * LOGO_SIZE + 2);
});

test("a gradient app icon fills the circle, unless detail reaches its edge", async () => {
  const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7d2ae8"/><stop offset="1" stop-color="#00c4cc"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>`;
  const filled = await frameLogo(await png(256, `${gradient}<circle cx="50" cy="50" r="20" fill="#fff"/>`));
  assert.equal(filled?.fit, "tile");
  const crowded = await frameLogo(await png(256, `${gradient}<rect x="2" y="44" width="96" height="12" fill="#fff"/>`));
  assert.equal(crowded?.fit, "inset");
  assert.ok((await reach(crowded!.png)) <= 0.84 * (LOGO_SIZE / 2) + 2);
});

test("a white mark goes on the brand's colour when given one it shows on", async () => {
  const mark = await png(96, `<circle cx="50" cy="50" r="30" fill="#fff"/>`);
  assert.deepEqual((await look((await frameLogo(mark, { brand: [0, 82, 204] }))!.png)).bg, [0, 82, 204]);
  // Not a colour the mark would vanish on.
  assert.deepEqual((await look((await frameLogo(mark, { brand: [250, 240, 230] }))!.png)).bg, [10, 10, 10]);
});

test("a white mark on transparency goes on black, so it shows", async () => {
  const logo = await frameLogo(await png(96, `<circle cx="50" cy="50" r="30" fill="#fff"/>`));
  assert.ok(logo);
  assert.deepEqual((await look(logo.png)).bg, [10, 10, 10]);
});

test("icons too small to be sharp, and pictures that are not icons, are turned down", async () => {
  assert.equal(await frameLogo(await png(16, `<rect x="20" y="20" width="60" height="60" fill="#d00"/>`)), null);
  assert.equal(await frameLogo(await png(32, `<rect x="20" y="20" width="60" height="60" fill="#d00"/>`)), null);
  assert.equal(await frameLogo(Buffer.from("<!doctype html><title>Blocked</title>")), null);
  // A vector icon is drawn large, so its declared size does not matter.
  const svg = await frameLogo(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M2 2h12v12H2z" fill="#e60023"/><path d="M6 4h4v8H6z" fill="#fff"/></svg>`));
  assert.ok(svg && svg.quality >= 120);
});

test("ICO files: the largest picture inside is used", async () => {
  // A 64px 32-bit bitmap (blue, opaque) after a 16px PNG entry.
  const width = 64;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(width * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(width * width * 4);
  for (let i = 0; i < width * width; i++) pixels.set([200, 0, 0, 255], i * 4); // BGRA: blue
  const mask = Buffer.alloc((width / 8) * width);
  const bitmap = Buffer.concat([header, pixels, mask]);
  const small = await png(16, `<rect width="100" height="100" fill="#0f0"/>`);
  const dir = Buffer.alloc(6 + 32);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(2, 4);
  dir.writeUInt8(16, 6); dir.writeUInt8(16, 7); dir.writeUInt32LE(small.length, 14); dir.writeUInt32LE(38, 18);
  dir.writeUInt8(64, 22); dir.writeUInt8(64, 23); dir.writeUInt32LE(bitmap.length, 30); dir.writeUInt32LE(38 + small.length, 34);
  const decoded = await decodeIcon(Buffer.concat([dir, small, bitmap]));
  assert.ok(decoded);
  assert.equal(decoded.raw.width, 64);
  assert.deepEqual([...decoded.raw.data.subarray(0, 4)], [0, 0, 200, 255]);
});
