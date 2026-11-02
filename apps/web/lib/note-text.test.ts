// Tests for note-text.ts: file reference lines, referenced and unused files, previews and excerpts, blank notes and
// search matching.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FILE_LINE, checklistProgress, fileLine, isBlankNote, matchesNote, matchingLine, noteExcerpt, referencedFiles, sortNotes, unusedFiles } from "./note-text";

const A = "0a1b2c3d-1111-4222-8333-944445555666";
const B = "9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff";

test("file lines round trip through the pattern", () => {
  const image = fileLine(A, "Site Photo.jpg", true);
  assert.equal(image, `![Site Photo.jpg](attachment:${A})`);
  const m = FILE_LINE.exec(`${image}\nNext paragraph`);
  assert.ok(m);
  assert.deepEqual([m[1], m[2], m[3]], ["!", "Site Photo.jpg", A]);
  assert.equal(FILE_LINE.exec(fileLine(B, "quote.pdf", false))?.[1], "");
});

test("names that would break the reference are cleaned", () => {
  assert.equal(fileLine(A, "Plan [final]\nv2.pdf", false), `[Plan final v2.pdf](attachment:${A})`);
});

test("a file reference inside a sentence is not a file line", () => {
  assert.equal(FILE_LINE.exec(`See [quote](attachment:${A}) here`), null);
  assert.equal(FILE_LINE.exec(`[quote](https://example.com)`), null);
});

test("referenced and unused files", () => {
  const md = `# Call\n\n${fileLine(A, "a.png", true)}\n\nText`;
  assert.deepEqual([...referencedFiles(md)], [A]);
  assert.deepEqual(unusedFiles([{ id: A }, { id: B }], md), [{ id: B }]);
});

test("excerpt is the first lines of text without markdown", () => {
  assert.equal(noteExcerpt("# Client Call\n\nMore"), "Client Call More");
  assert.equal(noteExcerpt(`${fileLine(A, "a.png", true)}\n\n- [ ] **Book** the _follow-up_`), "Book the follow-up");
  assert.equal(noteExcerpt("---\n\n> Quoted [link](https://x.co) and `code`"), "Quoted link and code");
  assert.equal(noteExcerpt("| Item | Price |\n| --- | --- |\n| Deposit | R5 000 |"), "Item Price Deposit R5 000");
  assert.equal(noteExcerpt("1. First\\*"), "First*");
  assert.equal(noteExcerpt("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(noteExcerpt(""), "");
  assert.equal(noteExcerpt("x".repeat(200), 10), "xxxxxxxxx…");
});

test("blank notes", () => {
  assert.ok(isBlankNote({ title: " ", body: "\n&nbsp;\n" }));
  assert.ok(!isBlankNote({ title: "Hi", body: "" }));
  assert.ok(!isBlankNote({ title: "", body: "text" }));
});

test("pinned first, then newest", () => {
  const notes = [
    { id: "old", pinned: false, updatedAt: "2026-10-01T00:00:00Z" },
    { id: "new", pinned: false, updatedAt: "2026-10-20T00:00:00Z" },
    { id: "pin", pinned: true, updatedAt: "2026-09-01T00:00:00Z" },
  ];
  assert.deepEqual(sortNotes(notes).map((n) => n.id), ["pin", "new", "old"]);
});

test("search matches every word across title and text", () => {
  const note = { title: "Client Call", body: "Deposit of **R5 000** by Friday" };
  assert.ok(matchesNote(note, "call friday"));
  assert.ok(matchesNote(note, ""));
  assert.ok(!matchesNote(note, "call monday"));
});

test("the matching line is the first line holding a search word", () => {
  const body = "# Client Call\n\n- [ ] Send the **quote**\nDeposit of R5 000 by Friday";
  assert.equal(matchingLine(body, "friday"), "Deposit of R5 000 by Friday");
  assert.equal(matchingLine(body, "quote deposit"), "Send the quote");
  assert.equal(matchingLine(body, "monday"), null);
  assert.equal(matchingLine(body, ""), null);
  const long = `${"a ".repeat(100)}needle ${"b ".repeat(100)}`;
  const line = matchingLine(long, "needle", 60)!;
  assert.ok(line.includes("needle") && line.length <= 62);
});

test("the excerpt joins the first lines as plain text and is kept short", () => {
  const body = `# Client Call\n\n${fileLine(A, "a.png", true)}\n\n- [ ] Send the **quote**\nDeposit by Friday`;
  assert.equal(noteExcerpt(body), "Client Call Send the quote Deposit by Friday");
  assert.equal(noteExcerpt(""), "");
  assert.equal(noteExcerpt("---\n```"), "");
  const long = noteExcerpt(`${"word ".repeat(100)}`, 50);
  assert.ok(long.length <= 50 && long.endsWith("…"));
  assert.equal(noteExcerpt("x".repeat(500)).length, 200);
});

test("search uses the excerpt until the body is downloaded", () => {
  const unloaded = { title: "Call", body: "", excerpt: "Deposit by Friday", unloaded: true };
  assert.ok(matchesNote(unloaded, "friday"));
  assert.ok(!matchesNote(unloaded, "monday"));
  assert.ok(!matchesNote({ ...unloaded, excerpt: null }, "friday"));
  assert.ok(matchesNote({ title: "Call", body: "Deposit by Friday", excerpt: "x" }, "friday"));
});

test("checklist progress counts ticked and total items", () => {
  assert.deepEqual(checklistProgress("- [x] Call\n- [ ] Quote\n  - [X] Send\nplain"), { done: 2, total: 3 });
  assert.equal(checklistProgress("- plain\n1. item"), null);
  assert.equal(checklistProgress(""), null);
});
