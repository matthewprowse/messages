// Draws the installable-app icons from apps/web/public/icon.svg: 192 and 512 pixel PNGs, and maskable versions with the
// artwork kept inside the safe zone (a launcher may crop the outer 20% to a circle or squircle). The PNGs are committed;
// run this only when icon.svg changes: pnpm --filter worker pwa:icons

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicDir = fileURLToPath(new URL("../../web/public/", import.meta.url));
const svg = readFileSync(`${publicDir}icon.svg`, "utf8");
const colour = /<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1] ?? "#c2410c";
// The speech bubble and dots, without the rounded square behind them.
const art = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<rect[^>]*\/>/, "");

/** Full-bleed colour with the artwork scaled into the middle 70%, so any mask shape still shows all of it. */
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${colour}"/><g transform="translate(9.6 9.6) scale(0.7)">${art}</g></svg>`;

for (const size of [192, 512]) {
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(`${publicDir}icon-${size}.png`);
  await sharp(Buffer.from(maskable), { density: 384 }).resize(size, size).png().toFile(`${publicDir}icon-maskable-${size}.png`);
}
console.log("Wrote icon-192, icon-512, icon-maskable-192 and icon-maskable-512 to apps/web/public");
