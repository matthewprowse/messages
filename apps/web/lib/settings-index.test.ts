// Tests for settings-index.ts: the search finds sections and settings by title and keyword, hides what the person may not
// see, links each hit to its card (and Team view), and old card addresses map to where the cards moved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_ENTRIES, SETTINGS_SECTIONS, entryHref, movedCard, searchSettings, visibleSections, type SettingsAccess } from "./settings-index";

const nobody: SettingsAccess = { team: false, manager: false, oversight: false, owner: false };
const everyone: SettingsAccess = { team: true, manager: true, oversight: true, owner: true };

test("Team and Updates show only to people who may see them", () => {
  const keys = (a: SettingsAccess) => visibleSections(a).map((s) => s.key);
  assert.ok(!keys(nobody).includes("team"));
  assert.ok(!keys(nobody).includes("updates"));
  assert.deepEqual(keys(everyone), SETTINGS_SECTIONS.map((s) => s.key));
});

test("a search matches every word against titles and keywords, case aside", () => {
  const { entries } = searchSettings("QUIET hours", nobody);
  assert.deepEqual(entries.map((x) => x.title), ["Quiet Hours"]);
  assert.equal(entries[0].href, "/settings/notifications#push");
  assert.equal(entries[0].sectionLabel, "Notifications");
  assert.deepEqual(searchSettings("theme", nobody).entries.map((x) => x.title), ["Appearance"]);
});

test("a search finds sections too, and an empty one finds nothing", () => {
  assert.deepEqual(searchSettings("privacy", nobody).sections.map((s) => s.key), ["privacy"]);
  assert.deepEqual(searchSettings("   ", everyone), { sections: [], entries: [] });
});

test("role gated settings are left out of the search for people without the role", () => {
  assert.equal(searchSettings("work chats", nobody).entries.length, 0);
  assert.equal(searchSettings("response times", { ...nobody, team: true }).entries.length, 0);
  const hit = searchSettings("response times", { ...nobody, team: true, manager: true }).entries[0];
  assert.equal(hit.href, "/settings/team?view=activity#response");
  assert.equal(searchSettings("changelog", nobody).sections.length, 0);
});

test("every entry belongs to a known section and links to its card", () => {
  const keys = new Set(SETTINGS_SECTIONS.map((s) => s.key));
  for (const x of SETTINGS_ENTRIES) {
    assert.ok(keys.has(x.section), x.title);
    assert.match(entryHref(x), /^\/settings\/[a-z-]+(\?view=[a-z-]+)?#[a-z-]+$/);
  }
});

test("cards that moved section still open from their old address", () => {
  assert.equal(movedCard("/settings/ai#templates"), "/settings/drafts#templates");
  assert.equal(movedCard("/settings/profile#delete-account"), "/settings/privacy#delete-account");
  assert.equal(movedCard("/settings/ai#priorities"), undefined);
});
