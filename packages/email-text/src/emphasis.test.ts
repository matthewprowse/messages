// Tests for emphasisRuns in packages/email-text/src/index.ts: bold, italic, underline, strike and code runs read from
// tags and inline styles in document order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emphasisRuns } from "./index";

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
