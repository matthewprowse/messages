// The Title Case rule for app text (AGENTS.md, UI rules), checked on every component that has screen tests and on the
// parts they render: each button, menu item and dialog title written in the source must be in Title Case.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buttonLabels, isTitleCase } from "./title-case";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Parts the screen tests render through their parent, with no test file of their own. */
const PARTS = ["components/thread-view/draft-bar.tsx", "components/template-picker.tsx", "components/outbox-attachments.tsx", "components/snooze/snooze-items.tsx", "components/attachments/attach-menu.tsx"];

/** Every component with a screen test beside it, plus the parts above. */
function screenTested(): string[] {
  const tested = readdirSync(`${ROOT}components`, { recursive: true }).map(String).filter((f) => f.endsWith(".test.tsx")).map((f) => `components/${f.replace(/\.test\.tsx$/, ".tsx")}`);
  return [...tested, ...PARTS].filter((f) => existsSync(`${ROOT}${f}`)).sort();
}

test("a label is Title Case when every word is capitalised but short joining words inside it", () => {
  for (const ok of ["Send", "Pick a Date and Time", "Add to Calendar", "Mark as Read", "Sending in 5s", "Connect iCloud", "Save (2)"]) assert.ok(isTitleCase(ok), ok);
  for (const bad of ["Send later", "add to Calendar", "Pick a date", "Archive all", "Mark As read", "Go to"]) assert.ok(!isTitleCase(bad), bad);
});

test("labels are read from button text, both sides of a ternary, and aria-label, never from class names or icons", () => {
  const src = `<Button variant="ghost" aria-label="Insert Template" onClick={() => go(a > b)}><FileText className="size-4" />{saving ? "Saving" : "Save Note"}</Button>
    <DropdownMenuItem onSelect={() => undefined}>Move to Junk</DropdownMenuItem><DialogTitle>Edit Contact</DialogTitle>`;
  assert.deepEqual(buttonLabels(src), ["Insert Template", "Saving", "Save Note", "Move to Junk", "Edit Contact"]);
});

test("every button, menu item and dialog title in the screen-tested components is Title Case", () => {
  const files = screenTested();
  assert.ok(files.length >= 40, `expected the 40 screen-tested components, found ${files.length}`);
  const wrong: string[] = [];
  let seen = 0;
  for (const file of files) {
    for (const label of buttonLabels(readFileSync(`${ROOT}${file}`, "utf8"))) {
      seen++;
      if (!isTitleCase(label)) wrong.push(`${file}: "${label}"`);
    }
  }
  assert.ok(seen > 100, `the scan found only ${seen} labels, so it has stopped reading the source`);
  assert.deepEqual(wrong, []);
});
