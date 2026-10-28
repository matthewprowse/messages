// The editor's document laid out as a PDF the way the note reads: headings, styled text, lists with bullets, numbers
// and check boxes, quotes, shaded code, rules, bordered tables and pictures. Files that are not pictures are listed by name.

import { PdfDoc, MARGIN, PAGE_W, type Picture, type Run, type Style } from "./pdf-writer";

interface Mark { type: string; attrs?: Record<string, unknown> }
interface Node {
  type?: string;
  text?: string;
  marks?: Mark[];
  attrs?: Record<string, unknown>;
  content?: Node[];
}

const GREY: [number, number, number] = [0.42, 0.42, 0.42];
const LINK: [number, number, number] = [0.1, 0.3, 0.75];
const SIZE = 11;

/** Everything a note needs to become a PDF besides its document: where each picture's bytes come from. */
export type PictureOf = (fileId: string) => Promise<Picture | null>;

function runsOf(node: Node, inherited: Style = {}): Run[] {
  if (node.type === "hardBreak") return [{ text: "\n" }];
  if (node.type === "noteFile") return [{ text: `[File: ${String(node.attrs?.name ?? "Attachment")}]`, color: GREY }];
  if (node.text !== undefined) {
    const style: Style = { ...inherited };
    for (const m of node.marks ?? []) {
      if (m.type === "bold") style.bold = true;
      else if (m.type === "italic") style.italic = true;
      else if (m.type === "strike") style.strike = true;
      else if (m.type === "code") style.mono = true;
      else if (m.type === "link") { style.underline = true; style.color = LINK; }
    }
    return [{ text: node.text, ...style }];
  }
  return (node.content ?? []).flatMap((c) => runsOf(c, inherited));
}

const plain = (runs: Run[]) => runs.map((r) => r.text).join("");

function pictureIds(nodes: Node[], out: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.type === "noteFile" && n.attrs?.image && n.attrs.id) out.add(String(n.attrs.id));
    if (n.content) pictureIds(n.content, out);
  }
  return out;
}

interface Ctx { doc: PdfDoc; pictures: Map<string, Picture>; quote: boolean }

function blocks(nodes: Node[], x: number, width: number, ctx: Ctx) {
  const { doc } = ctx;
  for (const n of nodes) {
    switch (n.type) {
      case "heading": {
        const level = Number(n.attrs?.level ?? 1);
        const size = level === 1 ? 20 : level === 2 ? 16 : 13.5;
        doc.paragraph(runsOf(n, { bold: true }), { x, width, size, before: level === 1 ? 14 : 11 });
        break;
      }
      case "paragraph": {
        const runs = runsOf(n, ctx.quote ? { color: GREY } : {});
        doc.paragraph(plain(runs) ? runs : [{ text: " " }], { x, width, size: SIZE, before: 4, bar: ctx.quote });
        break;
      }
      case "bulletList":
      case "orderedList":
      case "taskList":
        (n.content ?? []).forEach((item, i) => listItem(n.type!, item, i, x, width, ctx));
        break;
      case "blockquote":
        blocks(n.content ?? [], x + 14, width - 14, { ...ctx, quote: true });
        break;
      case "codeBlock":
        doc.paragraph([{ text: plain(runsOf(n)).replace(/\n$/, ""), mono: true }], { x: x + 7, width: width - 14, size: 9.5, before: 6, shade: [0.95, 0.95, 0.95], pad: 7 });
        break;
      case "horizontalRule":
        doc.space(8);
        doc.ensure(2);
        doc.line(x, doc.y, x + width, doc.y, [0.8, 0.8, 0.8]);
        doc.space(8);
        break;
      case "table":
        table(n, x, width, ctx);
        break;
      case "noteFile": {
        const picture = n.attrs?.id ? ctx.pictures.get(String(n.attrs.id)) : undefined;
        if (picture) doc.picture(picture, x, width, 8);
        else doc.paragraph([{ text: `File: ${String(n.attrs?.name ?? "Attachment")}`, color: GREY }], { x: x + 6, width: width - 12, size: 10, before: 6, shade: [0.95, 0.95, 0.95], pad: 6 });
        break;
      }
      default:
        if (n.content) blocks(n.content, x, width, ctx);
        else if (n.text) doc.paragraph(runsOf(n), { x, width, size: SIZE, before: 4 });
    }
  }
}

function listItem(kind: string, item: Node, index: number, x: number, width: number, ctx: Ctx) {
  const { doc } = ctx;
  const leading = SIZE * 1.4;
  const [first, ...rest] = item.content ?? [];
  const checked = !!item.attrs?.checked;
  const runs = first ? runsOf(first, checked ? { color: GREY, strike: true } : {}) : [];
  doc.space(3);
  doc.ensure(leading);
  const top = doc.y;
  if (kind === "bulletList") doc.dot(x + 5, top - leading * 0.55, 2);
  else if (kind === "orderedList") doc.paragraph([{ text: `${index + 1}.` }], { x, width: 18, size: SIZE });
  else doc.checkbox(x + 1, top - 2, 9.5, checked);
  doc.y = top;
  doc.paragraph(runs.length ? runs : [{ text: " " }], { x: x + 18, width: width - 18, size: SIZE });
  if (rest.length) blocks(rest, x + 18, width - 18, ctx);
}

function table(n: Node, x: number, width: number, ctx: Ctx) {
  const { doc } = ctx;
  const rows = n.content ?? [];
  const columns = Math.max(1, ...rows.map((r) => (r.content ?? []).length));
  const cell = width / columns;
  const pad = 5;
  const size = 10;
  doc.space(6);
  rows.forEach((row) => {
    const cells = row.content ?? [];
    const runsFor = cells.map((c) => runsOf(c, c.type === "tableHeader" ? { bold: true } : {}));
    const height = Math.max(...runsFor.map((r) => doc.measure(r.length && plain(r) ? r : [{ text: " " }], size, cell - 2 * pad)), size * 1.4) + 2 * pad;
    doc.ensure(height);
    const top = doc.y;
    cells.forEach((c, i) => {
      const left = x + i * cell;
      if (c.type === "tableHeader") doc.rect(left, top, cell, height, "fill", [0.94, 0.94, 0.94]);
    });
    cells.forEach((c, i) => {
      const left = x + i * cell;
      doc.y = top - pad;
      if (plain(runsFor[i])) doc.paragraph(runsFor[i], { x: left + pad, width: cell - 2 * pad, size });
      doc.rect(left, top, cell, height, "stroke", [0.7, 0.7, 0.7], 0.6);
    });
    doc.y = top - height;
  });
}

/** The PDF of a note: its title and the date, then its content laid out. Pictures are fetched first, in parallel. */
export async function notePdf(title: string, content: { content?: unknown[] }, pictureOf: PictureOf = async () => null, now: Date = new Date()): Promise<Uint8Array> {
  const nodes = (content.content ?? []) as Node[];
  const pictures = new Map<string, Picture>();
  await Promise.all([...pictureIds(nodes)].map(async (id) => {
    const found = await pictureOf(id).catch(() => null);
    if (found) pictures.set(id, found);
  }));

  const doc = new PdfDoc();
  const width = PAGE_W - 2 * MARGIN;
  doc.paragraph([{ text: title.trim() || "Untitled Note", bold: true }], { x: MARGIN, width, size: 22 });
  doc.paragraph([{ text: now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), color: GREY }], { x: MARGIN, width, size: 10, before: 2 });
  doc.space(6);
  doc.line(MARGIN, doc.y, MARGIN + width, doc.y, [0.8, 0.8, 0.8]);
  doc.space(4);
  blocks(nodes, MARGIN, width, { doc, pictures, quote: false });
  return doc.build();
}

/** A file name from the title: no characters a file system or the storage path dislikes. */
export function pdfName(title: string): string {
  const stem = title.trim().replace(/[^\p{L}\p{N} ._()-]+/gu, "").replace(/\s+/g, " ").slice(0, 80).trim();
  return `${stem || "Note"}.pdf`;
}
