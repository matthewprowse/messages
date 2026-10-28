// Tests for pdf-writer.ts and note-pdf.ts: the PDF structure is valid (header, xref offsets, end), text flows onto new
// pages, and a note keeps its styles, lists, tables and pictures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PdfDoc } from "./pdf-writer";
import { notePdf, pdfName } from "./note-pdf";

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

test("a PDF has a header, an xref whose offsets point at their objects, and an end", () => {
  const doc = new PdfDoc();
  doc.paragraph([{ text: "Hello (world) \\ caf\u00e9 \u2019 \ud83d\ude00" }], { x: 56, width: 400, size: 12 });
  const pdf = text(doc.build());
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
  assert.equal(pdf.slice(start, start + 4), "xref");
  const rows = pdf.slice(start).split("\n").filter((l) => /^\d{10} 00000 n/.test(l));
  rows.forEach((row, i) => assert.ok(pdf.slice(Number(row.slice(0, 10))).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  for (const word of ["(Hello)", "(\\(world\\))", "(\\\\)", "(caf\\351)", "(\\222)", "(?)"]) assert.ok(pdf.includes(word), word);
});

test("long text flows onto more pages", () => {
  const doc = new PdfDoc();
  for (let i = 0; i < 200; i++) doc.paragraph([{ text: `Line ${i}` }], { x: 56, width: 400, size: 11 });
  const pdf = text(doc.build());
  const pages = Number(/\/Count (\d+)/.exec(pdf)![1]);
  assert.ok(pages >= 3);
  assert.equal((pdf.match(/\/Type \/Page /g) ?? []).length, pages);
});

test("styles pick their fonts, and a picture is embedded as a JPEG", () => {
  const doc = new PdfDoc();
  doc.paragraph([{ text: "plain " }, { text: "bold", bold: true }, { text: " it", italic: true }, { text: " both", bold: true, italic: true }, { text: " code", mono: true }], { x: 56, width: 400, size: 11 });
  doc.picture({ bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), width: 100, height: 50 }, 56, 400);
  const pdf = text(doc.build());
  for (const f of ["/F1 ", "/F2 ", "/F3 ", "/F4 ", "/F5 "]) assert.ok(pdf.includes(f), f);
  assert.ok(pdf.includes("/Subtype /Image") && pdf.includes("/DCTDecode") && pdf.includes("/Im1 Do"));
});

test("a note keeps its structure: styles, lists, check boxes, tables, code and pictures", async () => {
  const t = (s: string, marks?: { type: string }[]) => ({ type: "text", text: s, marks });
  const para = (...c: unknown[]) => ({ type: "paragraph", content: c });
  const pdf = text(await notePdf("Plan: Q4", {
    content: [
      { type: "heading", attrs: { level: 2 }, content: [t("Goals")] },
      para(t("Ship "), t("it", [{ type: "bold" }]), t(" soon", [{ type: "italic" }])),
      { type: "bulletList", content: [{ type: "listItem", content: [para(t("One"))] }] },
      { type: "orderedList", content: [{ type: "listItem", content: [para(t("Two"))] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [para(t("Done"))] }, { type: "taskItem", attrs: { checked: false }, content: [para(t("Open"))] }] },
      { type: "codeBlock", content: [t("let x = 1")] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [para(t("A"))] }, { type: "tableHeader", content: [para(t("B"))] }] }] },
      { type: "noteFile", attrs: { id: "f1", name: "pic.png", image: true } },
      { type: "noteFile", attrs: { id: "f2", name: "scan.pdf", image: false } },
    ],
  }, async (id) => (id === "f1" ? { bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), width: 80, height: 40 } : null), new Date("2026-10-28T10:00:00Z")));
  for (const part of ["(Plan:)", "(Q4)", "(October)", "(Goals)", "(Two)", "(Done)", "(Open)", "(let)", "(A)", "(scan.pdf)", "/Im1 Do", "/F2 "]) assert.ok(pdf.includes(part), part);
});

test("a file name from a title keeps letters and drops the rest", () => {
  assert.equal(pdfName("  Q4 / Plan: \"final\"  "), "Q4 Plan final.pdf");
  assert.equal(pdfName("???"), "Note.pdf");
});
