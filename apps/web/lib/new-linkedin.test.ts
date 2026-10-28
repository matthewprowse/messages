// Tests for new-linkedin.ts: accepting a profile link in any common form, URNs, contact search and the existing chat
// lookup.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Contact, Thread } from "./types";
import { existingLinkedInChat, linkedinAccounts, linkedinUrnOf, parseLinkedInProfile, searchLinkedInContacts } from "./new-linkedin";

test("parseLinkedInProfile takes a profile link in any common form", () => {
  const want = "https://www.linkedin.com/in/sam-example-1a2b3c4d";
  assert.equal(parseLinkedInProfile("https://www.linkedin.com/in/sam-example-1a2b3c4d/"), want);
  assert.equal(parseLinkedInProfile("  linkedin.com/in/sam-example-1a2b3c4d?utm_source=share&utm_medium=member_ios "), want);
  assert.equal(parseLinkedInProfile("http://za.linkedin.com/in/sam-example-1a2b3c4d/details/experience/"), want);
  assert.equal(parseLinkedInProfile("www.linkedin.com/in/jos%C3%A9-pe%C3%B1a"), "https://www.linkedin.com/in/jos%C3%A9-pe%C3%B1a");
});

test("parseLinkedInProfile takes a profile URN as it is", () => {
  assert.equal(parseLinkedInProfile("urn:li:fsd_profile:ACoAAOTHER"), "urn:li:fsd_profile:ACoAAOTHER");
  assert.equal(parseLinkedInProfile("urn:li:fsd_profile:"), null);
  assert.equal(parseLinkedInProfile("urn:li:fsd_profile:a/b"), null);
});

test("parseLinkedInProfile refuses anything that is not one person's profile", () => {
  for (const input of ["", "   ", "Sam Example", "sam-example", "https://example.com/in/sam", "https://www.linkedin.com/company/acme", "https://www.linkedin.com/in/", "https://notlinkedin.com/in/sam", "https://evil.test/?u=linkedin.com/in/sam", "linkedin.com/"]) {
    assert.equal(parseLinkedInProfile(input), null, input);
  }
});

test("linkedinAccounts keeps connected LinkedIn accounts only", () => {
  const accounts = [
    { id: "a", provider: "linkedin", status: "connected" },
    { id: "b", provider: "linkedin", status: "syncing" },
    { id: "c", provider: "linkedin", status: "error" },
    { id: "d", provider: "whatsapp", status: "connected" },
  ];
  assert.deepEqual(linkedinAccounts(accounts).map((a) => a.id), ["a", "b"]);
});

const contact = (p: Partial<Contact>): Contact => ({ id: "c", name: "Sam Example", initials: "SE", hue: 0, emails: [], phones: [], isCompany: false, ...p });

test("a contact's LinkedIn profile is found among their numbers", () => {
  assert.equal(linkedinUrnOf(contact({ phones: ["+27821234567", "urn:li:fsd_profile:ACoAAOTHER"] })), "urn:li:fsd_profile:ACoAAOTHER");
  assert.equal(linkedinUrnOf(contact({ phones: ["+27821234567"] })), undefined);
});

test("searchLinkedInContacts finds contacts with a profile by the words of their name", () => {
  const contacts = [
    contact({ id: "sam", name: "Sam Example", phones: ["urn:li:fsd_profile:A1"] }),
    contact({ id: "samantha", name: "Samantha Roe", phones: ["urn:li:fsd_profile:B2"] }),
    contact({ id: "nolink", name: "Sam Nolink", phones: ["+27821234567"] }),
  ];
  assert.deepEqual(searchLinkedInContacts(contacts, "sam").map((r) => r.contact.id), ["sam", "samantha"]);
  assert.deepEqual(searchLinkedInContacts(contacts, "example sam").map((r) => r.urn), ["urn:li:fsd_profile:A1"]);
  assert.deepEqual(searchLinkedInContacts(contacts, "nolink"), []);
  assert.deepEqual(searchLinkedInContacts(contacts, "  "), []);
  assert.equal(searchLinkedInContacts(contacts, "sam", 1).length, 1);
});

const thread = (p: Partial<Thread>) => ({ id: "t", channel: "linkedin" as const, isGroup: false, lastMessageAt: "2026-10-01T00:00:00Z", participantIds: ["sam"], ...p });

test("existingLinkedInChat finds the newest one-to-one conversation with the contact", () => {
  const threads = [
    thread({ id: "old", lastMessageAt: "2026-01-01T00:00:00Z" }),
    thread({ id: "new", lastMessageAt: "2026-10-01T00:00:00Z" }),
    thread({ id: "group", isGroup: true }),
    thread({ id: "other", participantIds: ["someone"] }),
    { ...thread({ id: "email" }), channel: "email" as const },
  ];
  assert.equal(existingLinkedInChat(threads, "sam")?.id, "new");
  assert.equal(existingLinkedInChat(threads, "nobody"), undefined);
  assert.equal(existingLinkedInChat([thread({ id: "a", accountId: "other" })], "sam", "mine"), undefined);
  assert.equal(existingLinkedInChat([thread({ id: "a", accountId: "mine" })], "sam", "mine")?.id, "a");
});
