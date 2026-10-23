import assert from "node:assert/strict";
import { test } from "node:test";
import { followMerges, identityGroups, isPlaceholderName, mergeReasonText, namesDiffer, planMerge, preferredName, suggestionReasonText } from "./merging";

const side = (id: string, name: string, emails: string[] = [], phones: string[] = [], conversations = 0, hasWhatsApp = false) => ({ id, name, emails, phones, conversations, hasWhatsApp });

test("placeholder names are numbers, addresses and privacy ids", () => {
  for (const n of ["", "  ", "+27 82 123 4567", "(021) 555-1234", "1234567890@lid", "geoff@example.com"]) assert.equal(isPlaceholderName(n), true, n);
  for (const n of ["Geoff", "Geoff Prowse", "Zoë 2"]) assert.equal(isPlaceholderName(n), false, n);
});

test("the same name written differently does not ask", () => {
  assert.equal(preferredName("Geoff Prowse", "geoff prowse"), null);
  assert.equal(preferredName("Prowse, Geoff", "Geoff Prowse"), null);
  assert.equal(preferredName("Zoë Smith", "Zoe Smith"), null);
  assert.equal(namesDiffer("José García", "Garcia Jose"), false);
});

test("a real or fuller name wins without asking", () => {
  assert.equal(preferredName("+27821234567", "Geoff Prowse"), "Geoff Prowse");
  assert.equal(preferredName("Geoff", "Geoff Prowse"), "Geoff Prowse");
  assert.equal(preferredName("Geoff Prowse", "geoff@x.com"), "Geoff Prowse");
  assert.equal(preferredName("+1", "123@lid"), null);
});

test("two different real names ask", () => {
  assert.equal(namesDiffer("Geoffrey Prowse", "Geoff Prowse"), true);
  assert.equal(namesDiffer("Dad", "Geoff Prowse"), true);
});

test("the contact whose name is kept survives", () => {
  const a = side("a", "Dad", [], ["+27821234567"], 9);
  const b = side("b", "Geoff Prowse", ["geoff@x.com"], [], 2);
  assert.deepEqual(planMerge(a, b, "Geoff Prowse"), { keepId: "b", mergeId: "a", name: "Geoff Prowse" });
  assert.deepEqual(planMerge(a, b, "Dad"), { keepId: "a", mergeId: "b", name: "Dad" });
  assert.deepEqual(planMerge(side("a", "+27821234567"), side("b", "Geoff")), { keepId: "b", mergeId: "a", name: "Geoff" });
});

test("otherwise the busier contact survives", () => {
  assert.deepEqual(planMerge(side("a", "Geoff Prowse", [], [], 1), side("b", "geoff prowse", [], [], 5)), { keepId: "b", mergeId: "a" });
  assert.deepEqual(planMerge(side("a", "Geoff Prowse", [], [], 3), side("b", "geoff prowse", [], [], 3)), { keepId: "a", mergeId: "b" });
});

test("suggestion reasons in plain words", () => {
  const email = side("a", "Geoff Prowse", ["geoff@x.com"]);
  const wa = side("b", "Geoff Prowse", [], ["+27821234567"]);
  const hidden = side("c", "Geoff Prowse", [], [], 0, true);
  assert.equal(suggestionReasonText("same_name", email, wa), "Same name on email and WhatsApp");
  assert.equal(suggestionReasonText("same_name", hidden, email), "Same name on email and WhatsApp");
  assert.equal(suggestionReasonText("same_name", email, side("d", "Geoff Prowse", ["g@y.com"])), "Same name on different email addresses");
  assert.equal(suggestionReasonText("same_name", wa, hidden), "Same name on different numbers");
  assert.equal(suggestionReasonText("name_matches_address", email, wa), "Their email address matches this name");
  assert.equal(suggestionReasonText("same_company_name", email, wa, "Acme"), "Same name at Acme");
  assert.equal(suggestionReasonText("other", email, wa), "These look like the same person");
});

test("merge reasons name the address book", () => {
  assert.equal(mergeReasonText("address_book", ["icloud"]), "Matched by your iCloud address book");
  assert.equal(mergeReasonText("address_book", ["gmail"]), "Matched by your Google contacts");
  assert.equal(mergeReasonText("address_book", []), "Matched by your address book");
  assert.equal(mergeReasonText("signature"), "Their number is in their email signature");
  assert.equal(mergeReasonText("exact_match"), "The same number on both");
});

test("a number's phone and WhatsApp entries split together, privacy ids apart", () => {
  const groups = identityGroups([
    { id: "1", kind: "email", value: "geoff@x.com" },
    { id: "2", kind: "phone", value: "+27821234567" },
    { id: "3", kind: "whatsapp", value: "+27821234567" },
    { id: "4", kind: "whatsapp", value: "123456@lid" },
    { id: "5", kind: "whatsapp", value: "+447700900123" },
  ]);
  assert.deepEqual(groups, [
    { ids: ["1"], label: "geoff@x.com", detail: "Email" },
    { ids: ["2", "3"], label: "+27821234567", detail: "Phone and WhatsApp" },
    { ids: ["4"], label: "WhatsApp", detail: "Number hidden by WhatsApp" },
    { ids: ["5"], label: "+447700900123", detail: "WhatsApp" },
  ]);
});

test("merged ids follow the chain and stop on loops", () => {
  assert.equal(followMerges("a", { a: "b", b: "c" }), "c");
  assert.equal(followMerges("x", { a: "b" }), "x");
  assert.equal(followMerges("a", { a: "b", b: "a" }), "b");
});
