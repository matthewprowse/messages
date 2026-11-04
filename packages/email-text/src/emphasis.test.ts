// Tests for emphasisRuns in packages/email-text/src/index.ts: bold, italic, underline, strike and code runs read from
// tags and inline styles in document order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emphasisRuns, originalDoc } from "./index";

const runs = (html: string) => emphasisRuns(html).map((r) => `${r.mark}:${r.text}`);

test("emphasisRuns reads tags and inline styles in document order", () => {
  assert.deepEqual(
    runs('<p>Hi <b>Sam</b>, the <span style="font-weight: 700">viewing</span> is <i>Thursday</i>.</p><p><u>Bring ID</u> and <s>cash</s>, <code>ref-12</code>.</p>'),
    ["bold:Sam", "bold:viewing", "italic:Thursday", "underline:Bring ID", "strike:cash", "code:ref-12"],
  );
});

test("emphasisRuns treats headings as bold and nests marks", () => {
  assert.deepEqual(runs("<h2>Your offer</h2><p><strong>Accepted <em>today</em></strong></p>"), ["bold:Your offer", "bold:Accepted today", "italic:today"]);
});

test("emphasisRuns skips hidden parts, single characters and empty runs", () => {
  assert.deepEqual(runs('<b style="display:none">secret</b><b>x</b><b> </b><b>&nbsp;Real&nbsp;</b>'), ["bold:Real"]);
});

test("emphasisRuns uses a link's label and collapses whitespace", () => {
  assert.deepEqual(runs('<b>Open the\n  <a href="https://x.com">pull request</a></b>'), ["bold:Open the pull request"]);
});

test("emphasisRuns caps the number of runs", () => {
  assert.equal(emphasisRuns("<b>word</b>".repeat(400), 300).length, 300);
});

test("cleanText turns HTML links left in a text part into their label", async () => {
  const { cleanText } = await import("./index");
  assert.equal(
    cleanText('apply at <a href="education.github.com">education.github.com</a>.\nSee <a href="https://x.com/docs">the docs</a> or <A HREF=\'https://x.com\'>https://x.com</A>'),
    "apply at education.github.com.\nSee the docs (https://x.com/docs) or https://x.com",
  );
});

test("hostile HTML finishes quickly and still gives sensible output", () => {
  const timed = <T>(work: () => T): T => {
    const t = Date.now();
    const out = work();
    assert.ok(Date.now() - t < 500, `took ${Date.now() - t} ms`);
    return out;
  };
  assert.deepEqual(timed(() => emphasisRuns("<a ".repeat(200000))), []);
  assert.deepEqual(timed(() => emphasisRuns(`<b>Hello there</b>${"<a ".repeat(100000)}`)), [{ text: "Hello there", mark: "bold" }]);
  assert.deepEqual(timed(() => emphasisRuns(`<b>Hello there</b><script>${"<script ".repeat(50000)}`)), [{ text: "Hello there", mark: "bold" }]);
  const doc = timed(() => originalDoc(`<p>Hi</p><script>alert(1)${"<script ".repeat(100000)}`, false));
  assert.ok(doc.srcdoc.includes("<p>Hi</p>") && !/<script/i.test(doc.srcdoc));
  timed(() => originalDoc("<img ".repeat(200000) + ">", false));
  timed(() => originalDoc("url(//".repeat(200000), false));
  timed(() => originalDoc(' href="'.repeat(200000) + " onclick='".repeat(200000) + ' style="'.repeat(200000), false));
  timed(() => originalDoc("<style>".repeat(200000) + "\\72".repeat(200000), false));
});

test("HTML over the size limit has no emphasis, and deep nesting never throws", () => {
  assert.deepEqual(emphasisRuns(`<b>Hello there</b>${" ".repeat(600_000)}`), []);
  const nested = "<b>".repeat(5000) + "Deep words" + "</b>".repeat(5000);
  const runs = emphasisRuns(nested);
  assert.ok(runs.length > 0 && runs.every((r) => r.text === "Deep words" && r.mark === "bold"));
});
