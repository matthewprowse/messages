import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema, type JSONContent } from "@tiptap/react";
import { MarkdownManager } from "@tiptap/markdown";
import { NoteFileBase, noteContentExtensions } from "./note-markdown";

const extensions = [...noteContentExtensions(), NoteFileBase];
getSchema(extensions);
const md = new MarkdownManager({ extensions });
const A = "0a1b2c3d-1111-4222-8333-944445555666";
const B = "9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff";

const SAMPLE = `# Client Call

Agreed **R5 000** deposit, _by Friday_, ~~not Monday~~ and \`code\`. Tom & Jerry <b>.

## Points

- First
- Second
  - Nested

1. One
2. Two

- [ ] Book follow-up
- [x] Send quote

> A quote

\`\`\`
const x = 1;
\`\`\`

---

| Item | Price |
| --- | --- |
| Deposit | R5 000 |

![Site Photo.jpg](attachment:${A})

[quote.pdf](attachment:${B})

A [link](https://example.com).`;

function types(node: JSONContent, out = new Set<string>()): Set<string> {
  if (node.type) out.add(node.type);
  for (const m of node.marks ?? []) out.add(m.type);
  for (const c of node.content ?? []) types(c, out);
  return out;
}

test("every kind of formatting is read from markdown", () => {
  const found = types(md.parse(SAMPLE));
  for (const t of ["heading", "bulletList", "orderedList", "taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule", "table", "noteFile", "link", "bold", "italic", "strike", "code"]) {
    assert.ok(found.has(t), t);
  }
});

test("files are read as file blocks", () => {
  const files = (md.parse(SAMPLE).content ?? []).filter((n) => n.type === "noteFile");
  assert.deepEqual(files.map((f) => f.attrs), [
    { id: A, name: "Site Photo.jpg", image: true },
    { id: B, name: "quote.pdf", image: false },
  ]);
});

test("a note comes back the same after a second save", () => {
  const once = md.serialize(md.parse(SAMPLE));
  assert.equal(md.serialize(md.parse(once)), once);
  assert.match(once, new RegExp(`^!\\[Site Photo\\.jpg\\]\\(attachment:${A}\\)$`, "m"));
  assert.match(once, /^- \[x\] Send quote$/m);
});

test("HTML is kept as text, never as markup", () => {
  const out = md.serialize(md.parse("Hello <b>there</b> <img src=x onerror=alert(1)>"));
  assert.ok(!/<img|<b>/.test(out), out);
});

test("a file still uploading is left out", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }, { type: "noteFile", attrs: { id: null, name: "a.png", image: true, upload: "k" } }] };
  assert.equal(md.serialize(doc).trim(), "Hi");
});
