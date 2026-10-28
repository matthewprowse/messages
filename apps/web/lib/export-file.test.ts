// The compliance export's file: what it says, that nothing from a message can break out of it, and that the JSON carries the same content.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExportHtml, buildExportJson, exportFileName, stamp, totals, type ExportDoc } from "./export-file";

const doc: ExportDoc = {
  generatedAt: "2026-11-04T09:30:00.000Z",
  workspace: "Acme Properties",
  exportedBy: "Owner O",
  client: { name: "Thandi <b>Mokoena</b>", company: "Acme & Sons" },
  chats: [
    {
      threadId: "t1", label: "Thandi", channel: "whatsapp", kind: "agent", agent: "Sipho", inbox: null, sharedAt: "2026-10-01T08:00:00.000Z", shareFrom: "2026-10-01T08:00:00.000Z", notYetShared: 2,
      messages: [
        { id: "m1", sentAt: "2026-10-02T10:15:00.000Z", direction: "inbound", from: "Thandi", to: ["Sipho"], subject: "", text: "Is the flat <script>alert(1)</script> available?", quoted: null, files: [] },
        { id: "m2", sentAt: "2026-10-02T10:20:00.000Z", direction: "outbound", from: "Sipho", to: ["+27821112222"], subject: "Re: Viewing", text: "Yes.\nSee you Friday.", quoted: "Is the flat available?", files: ["quote.pdf", "keys \"photo\".jpg"] },
      ],
      notes: [{ author: "Member B", at: "2026-10-03T07:00:00.000Z", text: "She prefers calls & texts" }],
    },
    { threadId: "t2", label: "", channel: "email", kind: "shared_inbox", agent: "Sipho", inbox: "Info", sharedAt: "2026-10-05T08:00:00.000Z", shareFrom: null, notYetShared: 0, messages: [], notes: [] },
  ],
};

test("it counts what it holds", () => {
  assert.deepEqual(totals(doc), { chats: 2, messages: 2, notes: 1 });
});

test("the HTML says who, what, when and how far back, and warns about what was not yet shared", () => {
  const html = buildExportHtml(doc, "UTC");
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Work History: Thandi &lt;b&gt;Mokoena&lt;\/b&gt;<\/title>/);
  assert.match(html, /Exported by<\/td><td>Owner O/);
  assert.match(html, /2 chats, 2 messages, 1 note/);
  assert.match(html, /2 Oct 2026, 10:15 UTC/);
  assert.match(html, /History from 1 Oct 2026/);
  assert.match(html, /Whole history/);
  assert.match(html, /Shared inbox Info/);
  assert.match(html, /Agent Sipho/);
  assert.match(html, /2 messages were still being shared/);
  assert.match(html, /Attachments: quote.pdf, keys &quot;photo&quot;.jpg/);
  assert.match(html, /Nothing has been shared in this chat/);
  assert.match(html, /Internal Notes/);
  assert.match(html, /She prefers calls &amp; texts/);
});

test("nothing from a message or a name can become markup", () => {
  const html = buildExportHtml(doc, "UTC");
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<b>Mokoena"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!/<img|<iframe|<link|src=|href=/i.test(html), "no outside resource of any kind");
});

test("the file has no dashes of the long kind in its own wording", () => {
  const html = buildExportHtml({ ...doc, chats: [{ ...doc.chats[0], messages: [], notes: [] }] }, "UTC");
  assert.ok(!new RegExp("[\\u2013\\u2014]").test(html));
});

test("the JSON carries the same content with ISO times", () => {
  const parsed = JSON.parse(buildExportJson(doc));
  assert.equal(parsed.format, "konva-client-work-history");
  assert.deepEqual(parsed.totals, { chats: 2, messages: 2, notes: 1 });
  assert.equal(parsed.chats[0].messages[1].text, "Yes.\nSee you Friday.");
  assert.equal(parsed.chats[0].messages[1].sentAt, "2026-10-02T10:20:00.000Z");
  assert.deepEqual(parsed.chats[0].messages[1].attachments, ["quote.pdf", "keys \"photo\".jpg"]);
  assert.equal(parsed.chats[0].messages[0].subject, null);
  assert.equal(parsed.chats[0].notes[0].author, "Member B");
  assert.equal(parsed.chats[1].shareFrom, null);
  assert.equal(parsed.chats[1].inbox, "Info");
  assert.equal(parsed.client.company, "Acme & Sons");
});

test("a file name is safe anywhere", () => {
  assert.equal(exportFileName(doc, "html"), "Work History Thandi b Mokoena b 2026-11-04.html");
  assert.equal(exportFileName({ ...doc, client: { name: "../../etc/passwd", company: "" } }, "json"), "Work History etc passwd 2026-11-04.json");
  assert.equal(exportFileName({ ...doc, client: { name: "///", company: "" } }, "json"), "Work History Client 2026-11-04.json");
});

test("a time that cannot be read is shown as it came", () => {
  assert.equal(stamp("not a date"), "not a date");
});
