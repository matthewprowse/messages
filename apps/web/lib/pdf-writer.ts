// A small PDF layout engine for exporting a note, with no library behind it: A4 pages; text in the standard fonts
// (plain, bold, italic, bold italic and monospace) with mixed styles on a line, underlines, strike-through and links;
// bullets, numbers and check boxes; quotes, shaded code, rules, bordered tables; and pictures (as JPEG). The standard
// fonts only cover Western European text, so a character outside it (an emoji, another script) comes out as "?".

export interface Style {
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  strike?: boolean;
  underline?: boolean;
  /** Grey from 0 (black) to 1 (white), or a colour. */
  color?: [number, number, number];
}
export interface Run extends Style {
  text: string;
}
export interface Picture {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export const PAGE_W = 595;
export const PAGE_H = 842;
export const MARGIN = 56;
const TEXT_W = PAGE_W - 2 * MARGIN;

const BLACK: [number, number, number] = [0, 0, 0];

// Characters 0x80 to 0x9F in Windows-1252 that are not at their own code point in Unicode.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function byteOf(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (c === 9) return 0x20;
  if (c >= 0x20 && c < 0x7f) return c;
  if (c >= 0xa0 && c <= 0xff) return c;
  return CP1252[c] ?? 0x3f;
}

/** Text as a PDF string literal, with every byte outside plain ASCII written as an octal escape. */
function literal(text: string): string {
  let out = "";
  for (const ch of text) {
    const b = byteOf(ch);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b < 0x20 || b > 0x7e) out += `\\${b.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(b);
  }
  return `(${out})`;
}

const fontOf = (s: Style) => (s.mono ? "F5" : s.bold && s.italic ? "F4" : s.italic ? "F3" : s.bold ? "F2" : "F1");
const FONT_NAMES: Record<string, string> = { F1: "Helvetica", F2: "Helvetica-Bold", F3: "Helvetica-Oblique", F4: "Helvetica-BoldOblique", F5: "Courier" };

// Helvetica's own character widths (thousandths of the size) for the characters from space to tilde, as published in its
// font metrics. The PDF viewer draws with the same widths, so lines are laid out exactly as they are drawn, on any
// computer and without a browser. Italic has the regular widths, bold italic the bold ones.
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
// Characters beyond ASCII that are not a plain letter with an accent.
const OTHER: Record<number, [number, number]> = {
  0x2018: [222, 278], 0x2019: [222, 278], 0x201c: [333, 500], 0x201d: [333, 500], 0x2022: [350, 350], 0x2013: [556, 556], 0x2014: [1000, 1000],
  0x2026: [1000, 1000], 0x20ac: [556, 556], 0x2122: [1000, 1000], 0xa0: [278, 278], 0xa9: [737, 737], 0xae: [737, 737], 0xb0: [400, 400],
};

function charWidth(ch: string, bold: boolean): number {
  const c = ch.codePointAt(0)!;
  if (c >= 0x20 && c < 0x7f) return (bold ? BOLD : REGULAR)[c - 0x20];
  if (c === 9) return (bold ? BOLD : REGULAR)[0];
  const other = OTHER[c];
  if (other) return other[bold ? 1 : 0];
  const base = ch.normalize("NFD")[0];
  const b = base.codePointAt(0)!;
  if (b >= 0x20 && b < 0x7f && base !== ch) return (bold ? BOLD : REGULAR)[b - 0x20];
  return bold ? 611 : 556;
}

function widthOf(text: string, style: Style, size: number): number {
  if (style.mono) return [...text].length * size * 0.6;
  let sum = 0;
  for (const ch of text) sum += charWidth(ch, !!style.bold);
  return (sum * size) / 1000;
}

interface Token { text: string; style: Style; width: number; space: boolean; newline?: boolean }
interface Line { tokens: Token[]; width: number }

/** Runs broken into lines no wider than `width`: at spaces where there are any, anywhere where there are none. */
function layoutRuns(runs: Run[], size: number, width: number): Line[] {
  const tokens: Token[] = [];
  for (const run of runs) {
    const style: Style = { bold: run.bold, italic: run.italic, mono: run.mono, strike: run.strike, underline: run.underline, color: run.color };
    run.text.split("\n").forEach((part, i, all) => {
      for (const piece of part.split(/(\s+)/)) {
        if (piece) tokens.push({ text: piece.replace(/\s+/g, " "), style, width: widthOf(piece.replace(/\s+/g, " "), style, size), space: /^\s/.test(piece) });
      }
      if (i < all.length - 1) tokens.push({ text: "", style, width: 0, space: false, newline: true });
    });
  }
  const lines: Line[] = [];
  let line: Line = { tokens: [], width: 0 };
  const flush = () => {
    while (line.tokens.length && line.tokens[line.tokens.length - 1].space) line.width -= line.tokens.pop()!.width;
    lines.push(line);
    line = { tokens: [], width: 0 };
  };
  for (const token of tokens) {
    if (token.newline) { flush(); continue; }
    if (token.space && line.tokens.length === 0) continue;
    if (line.width + token.width > width && !token.space && line.tokens.length) flush();
    if (token.width > width && !token.space) {
      // A word wider than the line: cut where it fits.
      let rest = token.text;
      while (rest.length) {
        let n = rest.length;
        while (n > 1 && widthOf(rest.slice(0, n), token.style, size) > width - line.width) n--;
        const part = rest.slice(0, n);
        line.tokens.push({ ...token, text: part, width: widthOf(part, token.style, size) });
        line.width += widthOf(part, token.style, size);
        rest = rest.slice(n);
        if (rest) flush();
      }
      continue;
    }
    line.tokens.push(token);
    line.width += token.width;
  }
  if (line.tokens.length || lines.length === 0) flush();
  return lines;
}

export class PdfDoc {
  private pages: string[][] = [[]];
  private images: (Picture & { name: string })[] = [];
  /** Where the next thing goes: down from the top margin. */
  y = PAGE_H - MARGIN;

  private get ops() {
    return this.pages[this.pages.length - 1];
  }
  private newPage() {
    this.pages.push([]);
    this.y = PAGE_H - MARGIN;
  }
  /** Makes room for `height`, starting a new page when it will not fit. A page's first block is never pushed off. */
  ensure(height: number) {
    if (this.y - height < MARGIN && this.y < PAGE_H - MARGIN) this.newPage();
  }
  space(points: number) {
    this.y -= points;
  }

  // -- Shapes ---------------------------------------------------------------------------------------------

  rect(x: number, top: number, w: number, h: number, mode: "fill" | "stroke", color: [number, number, number] = BLACK, lineWidth = 0.6) {
    const c = color.map((v) => v.toFixed(3)).join(" ");
    const op = mode === "fill" ? `${c} rg ${x.toFixed(1)} ${(top - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f` : `${c} RG ${lineWidth} w ${x.toFixed(1)} ${(top - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S`;
    this.ops.push(op);
  }
  line(x1: number, y1: number, x2: number, y2: number, color: [number, number, number] = BLACK, lineWidth = 0.6) {
    this.ops.push(`${color.map((v) => v.toFixed(3)).join(" ")} RG ${lineWidth} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`);
  }
  dot(cx: number, cy: number, r: number, color: [number, number, number] = BLACK) {
    const k = 0.5523 * r;
    this.ops.push(
      `${color.map((v) => v.toFixed(3)).join(" ")} rg ${(cx + r).toFixed(2)} ${cy.toFixed(2)} m ` +
      `${(cx + r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + r).toFixed(2)} ${cx.toFixed(2)} ${(cy + r).toFixed(2)} c ` +
      `${(cx - k).toFixed(2)} ${(cy + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - r).toFixed(2)} ${cy.toFixed(2)} c ` +
      `${(cx - r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - r).toFixed(2)} ${cx.toFixed(2)} ${(cy - r).toFixed(2)} c ` +
      `${(cx + k).toFixed(2)} ${(cy - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + r).toFixed(2)} ${cy.toFixed(2)} c f`,
    );
  }
  /** A check box, ticked or not, with its top left at (x, top). */
  checkbox(x: number, top: number, size: number, checked: boolean) {
    if (checked) {
      this.rect(x, top, size, size, "fill", [0.2, 0.2, 0.2]);
      this.ops.push(`1 1 1 RG 1.3 w ${(x + size * 0.22).toFixed(1)} ${(top - size * 0.52).toFixed(1)} m ${(x + size * 0.43).toFixed(1)} ${(top - size * 0.75).toFixed(1)} l ${(x + size * 0.8).toFixed(1)} ${(top - size * 0.25).toFixed(1)} l S`);
    } else {
      this.rect(x, top, size, size, "stroke", [0.35, 0.35, 0.35], 0.9);
    }
  }

  // -- Text -----------------------------------------------------------------------------------------------

  /** Height a paragraph of these runs takes at this width. */
  measure(runs: Run[], size: number, width: number): number {
    return layoutRuns(runs, size, width).length * size * 1.4;
  }

  /**
   * Draws runs from x down the page, wrapping to `width`, and moves on. `shade` fills a band behind each line (for
   * code), and `bar` draws a vertical rule at its left (for a quote).
   */
  paragraph(runs: Run[], opts: { x: number; width: number; size: number; before?: number; shade?: [number, number, number]; bar?: boolean; pad?: number }) {
    const leading = opts.size * 1.4;
    this.space(opts.before ?? 0);
    for (const line of layoutRuns(runs, opts.size, opts.width)) {
      this.ensure(leading);
      const top = this.y;
      this.y -= leading;
      if (opts.shade) this.rect(opts.x - (opts.pad ?? 0), top, opts.width + 2 * (opts.pad ?? 0), leading, "fill", opts.shade);
      if (opts.bar) this.rect(opts.x - 10, top, 2, leading, "fill", [0.78, 0.78, 0.78]);
      const baseline = this.y + leading * 0.28;
      let x = opts.x;
      for (const t of line.tokens) {
        if (t.text.trim()) {
          const c = (t.style.color ?? BLACK).map((v) => v.toFixed(3)).join(" ");
          this.ops.push(`BT /${fontOf(t.style)} ${opts.size} Tf ${c} rg ${x.toFixed(1)} ${baseline.toFixed(1)} Td ${literal(t.text)} Tj ET`);
          if (t.style.underline) this.line(x, baseline - 1.5, x + t.width, baseline - 1.5, t.style.color ?? BLACK, 0.5);
          if (t.style.strike) this.line(x, baseline + opts.size * 0.3, x + t.width, baseline + opts.size * 0.3, t.style.color ?? BLACK, 0.5);
        }
        x += t.width;
      }
    }
  }

  // -- Pictures -------------------------------------------------------------------------------------------

  /** A picture as wide as fits, no taller than the page, kept in proportion. */
  picture(p: Picture, x: number, width: number, before = 6) {
    const maxH = PAGE_H - 2 * MARGIN;
    let w = Math.min(width, p.width);
    let h = (w * p.height) / p.width;
    if (h > maxH) { h = maxH; w = (h * p.width) / p.height; }
    this.space(before);
    this.ensure(h);
    const name = `Im${this.images.length + 1}`;
    this.images.push({ ...p, name });
    this.ops.push(`q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${x.toFixed(1)} ${(this.y - h).toFixed(1)} cm /${name} Do Q`);
    this.y -= h;
  }

  // -- Output ---------------------------------------------------------------------------------------------

  /** The finished file. */
  build(): Uint8Array {
    // Objects: 1 catalog, 2 page tree, 3 to 7 fonts, then a page and its content for each page, then the pictures.
    const parts: (string | Uint8Array)[][] = [];
    const objects: (string | Uint8Array)[] = [];
    const fontIds = ["F1", "F2", "F3", "F4", "F5"];
    const pageIds = this.pages.map((_, i) => 8 + i * 2);
    const imageBase = 8 + this.pages.length * 2;
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${this.pages.length} >>`;
    fontIds.forEach((f, i) => { objects[3 + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAMES[f]} /Encoding /WinAnsiEncoding >>`; });
    const xobjects = this.images.map((im, i) => `/${im.name} ${imageBase + i} 0 R`).join(" ");
    this.pages.forEach((content, i) => {
      const id = pageIds[i];
      const stream = content.join("\n");
      objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << ${fontIds.map((f, n) => `/${f} ${3 + n} 0 R`).join(" ")} >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> /Contents ${id + 1} 0 R >>`;
      objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });
    this.images.forEach((im, i) => {
      objects[imageBase + i] = [`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, "\nendstream"] as unknown as string;
    });

    const chunks: Uint8Array[] = [];
    let length = 0;
    const push = (data: string | Uint8Array) => {
      const bytes = typeof data === "string" ? Uint8Array.from(data, (c) => c.charCodeAt(0)) : data;
      chunks.push(bytes);
      length += bytes.length;
    };
    push("%PDF-1.4\n");
    const offsets: number[] = [];
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = length;
      push(`${id} 0 obj\n`);
      const body = objects[id];
      if (Array.isArray(body)) (body as unknown as (string | Uint8Array)[]).forEach(push);
      else push(body as string);
      push("\nendobj\n");
    }
    const xref = length;
    let table = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    push(`${table}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    void parts;
    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}

export { TEXT_W };
