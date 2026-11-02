// Tests for the note templates.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistProgress } from "./note-text";
import { fromTemplate, NOTE_TEMPLATES, shortDate } from "./note-templates";

test("the four templates are there with Title Case names", () => {
  assert.deepEqual(NOTE_TEMPLATES.map((t) => t.name), ["Call Note", "Meeting Note", "Quote", "Onboarding Checklist"]);
});

test("a template gives a dated title and its text", () => {
  const out = fromTemplate(NOTE_TEMPLATES[0], "2 Nov 2026");
  assert.equal(out.title, "Call 2 Nov 2026");
  assert.ok(out.body.includes("## Follow-Ups"));
});

test("every template carries a checklist the list can count", () => {
  for (const t of NOTE_TEMPLATES) assert.ok(checklistProgress(t.body), t.name);
});

test("no template uses an em or en dash", () => {
  for (const t of NOTE_TEMPLATES) assert.ok(!/[–—]/.test(t.body + t.title("x")), t.name);
});

test("a short date reads day, month, year", () => {
  assert.equal(shortDate(new Date(2026, 10, 2)), "2 Nov 2026");
});
