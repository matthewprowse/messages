// Tests for onboarding-findings.ts: the setup dialog never saves anything it made up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { aboutSeed, foundCounts, importSettled, keepPatch, peopleText, topPeople } from "./onboarding-findings";

const contact = (id: string, name: string, isCompany = false) => ({ id, name, isCompany });

test("aboutSeed uses only the role and the words the person typed", () => {
  assert.equal(aboutSeed("", ""), "");
  assert.equal(aboutSeed("other", ""), "");
  assert.equal(aboutSeed("attorney", ""), "You're an attorney.");
  assert.equal(aboutSeed("recruiter", "I place   engineers"), "You're a recruiter. I place engineers.");
});

test("keepPatch saves nothing when nothing was written or kept", () => {
  assert.deepEqual(keepPatch({ about: "", people: "" }, "", []), {});
});

test("keepPatch never overwrites what the person already filled in", () => {
  assert.deepEqual(keepPatch({ about: "Mine", people: "Sam" }, "Other", [{ name: "A", why: "" }]), {});
  assert.deepEqual(keepPatch({ about: "", people: "" }, " Hello ", [{ name: "A", why: "2 conversations" }]), { about: "Hello", people: "A: 2 conversations" });
});

test("topPeople ranks real contacts by conversations and skips groups, companies and unknown ids", () => {
  const threads = [
    { participantIds: ["a"], isGroup: false },
    { participantIds: ["a"] },
    { participantIds: ["b"] },
    { participantIds: ["a", "b", "c"], isGroup: true },
    { participantIds: ["co"] },
    { participantIds: ["ghost"] },
  ];
  const got = topPeople(threads, [contact("a", "Ann"), contact("b", "Bo"), contact("co", "Shop", true)]);
  assert.deepEqual(got, [{ name: "Ann", why: "2 conversations" }, { name: "Bo", why: "1 conversation" }]);
  assert.deepEqual(topPeople([], []), []);
});

test("peopleText omits the colon when there is no reason", () => {
  assert.equal(peopleText([{ name: "A", why: "" }, { name: "B", why: "x" }]), "A\nB: x");
});

test("foundCounts counts what is loaded and importSettled waits for syncing mail accounts", () => {
  assert.deepEqual(foundCounts([{ channel: "email" }, { channel: "whatsapp" }, { channel: "email" }], 5), { conversations: 3, emailConversations: 2, whatsappConversations: 1, contacts: 5 });
  assert.equal(importSettled([{ provider: "gmail", status: "syncing" }]), false);
  assert.equal(importSettled([{ provider: "whatsapp", status: "connecting" }]), false);
  assert.equal(importSettled([{ provider: "gmail", status: "connected" }, { provider: "google_calendar", status: "syncing" }]), true);
});
