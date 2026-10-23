import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseKeep,
  findMatches,
  identityKey,
  isPlaceholderName,
  isRoleAddress,
  mergeReason,
  nameKey,
  type MatchContact,
  type MatchIdentity,
  type MatchInput,
} from "./match";

// Synthetic people only.
let n = 0;
function world(spec: Record<string, { name: string; org?: string; ids?: [string, string][] }>, extra: Partial<MatchInput> = {}): MatchInput {
  const contacts: MatchContact[] = [];
  const identities: MatchIdentity[] = [];
  for (const [id, c] of Object.entries(spec)) {
    contacts.push({ id, name: c.name, organizationId: c.org ?? null });
    for (const [kind, value] of c.ids ?? []) identities.push({ id: `i${++n}`, contactId: id, kind, value });
  }
  return { contacts, identities, cards: [], signaturePhones: [], own: [], dismissed: [], groups: [], countryCode: "27", ...extra };
}

const clusterSets = (r: ReturnType<typeof findMatches>) => r.certain.map((c) => c.contacts.join(",")).sort();
const pairs = (r: ReturnType<typeof findMatches>) => r.suggestions.map((s) => `${s.contactA}-${s.contactB}:${s.reason}`).sort();

test("nameKey: case, accents, punctuation, titles and surname first", () => {
  assert.equal(nameKey("Geoff Prowse"), "geoff prowse");
  assert.equal(nameKey("PROWSE Geoff"), "geoff prowse");
  assert.equal(nameKey("Prowse, Geoff"), "geoff prowse");
  assert.equal(nameKey("Dr. Geoff Prowse"), "geoff prowse");
  assert.equal(nameKey("José Álvarez"), nameKey("Jose Alvarez"));
  assert.equal(nameKey("Zoë O'Brien"), nameKey("zoe obrien"));
  assert.equal(nameKey("Anne-Marie Smith"), nameKey("Smith Anne Marie"));
  assert.equal(nameKey("Geoff (Work)"), "geoff");
  assert.equal(nameKey("+27 82 123 4567"), null);
  assert.equal(nameKey("12345@lid"), null);
  assert.equal(nameKey("geoff@example.com"), null);
});

test("placeholders and role addresses", () => {
  assert.ok(isPlaceholderName("+27821234567"));
  assert.ok(isPlaceholderName("123@lid"));
  assert.ok(isPlaceholderName(""));
  assert.ok(!isPlaceholderName("Geoff"));
  for (const a of ["noreply@x.com", "no-reply@x.com", "info@x.co.za", "support@x.io", "hello@x.com", "team@x.com",
    "notifications@x.com", "mailer-daemon@x.com", "do-not-reply@x.com", "billing@x.com", "news@x.com", "accounts-noreply@x.com"]) {
    assert.ok(isRoleAddress(a), a);
  }
  for (const a of ["geoff@x.com", "geoff.prowse@x.com", "information.officer.jones@x.com", "sam@x.com"]) assert.ok(!isRoleAddress(a), a);
});

test("identityKey: privacy IDs are never numbers", () => {
  assert.equal(identityKey("whatsapp", "27821234567@lid", "27"), null);
  assert.equal(identityKey("whatsapp", "+27821234567", "27"), "p:+27821234567");
  assert.equal(identityKey("phone", "082 123 4567", "27"), "p:+27821234567");
  assert.equal(identityKey("email", "Geoff@Example.com", "27"), "e:geoff@example.com");
});

test("exact match: a phone identity equals the number behind another contact's WhatsApp identity", () => {
  const r = findMatches(world({
    a: { name: "Geoff Prowse", ids: [["phone", "+27821234567"]] },
    b: { name: "+27821234567", ids: [["whatsapp", "+27821234567"]] },
    c: { name: "Someone", ids: [["whatsapp", "27821234567@lid"]] },
  }));
  assert.deepEqual(clusterSets(r), ["a,b"]);
  assert.equal(r.certain[0].edges[0].reason, "exact_match");
});

test("address book card joins an email contact and a WhatsApp contact", () => {
  const r = findMatches(world(
    {
      a: { name: "Geoff Prowse", ids: [["email", "geoff@prowse.co.za"]] },
      b: { name: "Geoff", ids: [["whatsapp", "+27821234567"], ["phone", "+27821234567"]] },
      c: { name: "Other", ids: [["email", "other@x.com"]] },
    },
    { cards: [{ emails: ["geoff@prowse.co.za"], phones: ["082 123 4567"] }, { emails: ["other@x.com"], phones: [] }] },
  ));
  assert.deepEqual(clusterSets(r), ["a,b"]);
  assert.equal(mergeReason(r.certain[0], "b"), "address_book");
});

test("a card matching many contacts is a company or household card and is skipped", () => {
  const spec: Record<string, { name: string; ids: [string, string][] }> = {};
  const emails: string[] = [];
  for (let i = 0; i < 6; i++) {
    spec[`p${i}`] = { name: `Person ${i}`, ids: [["email", `person${i}@corp.com`]] };
    emails.push(`person${i}@corp.com`);
  }
  const r = findMatches(world(spec, { cards: [{ emails, phones: [] }] }));
  assert.equal(r.certain.length, 0);
  assert.equal(r.skipped.large_cards, 1);
});

test("signature number of exactly one person merges with the WhatsApp contact", () => {
  const r = findMatches(world(
    {
      e: { name: "Geoff Prowse", ids: [["email", "geoff@prowse.co.za"]] },
      w: { name: "+27821234567", ids: [["whatsapp", "+27821234567"], ["phone", "+27821234567"]] },
    },
    { signaturePhones: [{ contactId: "e", phone: "+27821234567" }, { contactId: "e", phone: "082 123 4567" }] },
  ));
  assert.deepEqual(clusterSets(r), ["e,w"]);
  assert.equal(r.certain[0].edges[0].reason, "signature");
});

test("a shared office number in two people's signatures merges nothing and suggests nothing", () => {
  const r = findMatches(world(
    {
      e1: { name: "Sam Jones", ids: [["email", "sam@acme.com"]] },
      e2: { name: "Lee Brown", ids: [["email", "lee@acme.com"]] },
      w: { name: "Acme Reception", ids: [["phone", "+27215551234"], ["whatsapp", "+27215551234"]] },
    },
    { signaturePhones: [{ contactId: "e1", phone: "+27215551234" }, { contactId: "e2", phone: "+27215551234" }] },
  ));
  assert.equal(r.certain.length, 0);
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.skipped.shared_numbers, 1);
});

test("a signature number only counts for email contacts", () => {
  const r = findMatches(world(
    { w1: { name: "A", ids: [["whatsapp", "+27821111111"]] }, w2: { name: "B", ids: [["phone", "+27822222222"]] } },
    { signaturePhones: [{ contactId: "w1", phone: "+27822222222" }] },
  ));
  assert.equal(r.certain.length, 0);
});

test("role addresses are never merged into a person", () => {
  const r = findMatches(world(
    {
      info: { name: "Acme", ids: [["email", "info@acme.com"]] },
      w: { name: "Acme Shop", ids: [["whatsapp", "+27215551234"]] },
      nr: { name: "Geoff Prowse", ids: [["email", "noreply@prowse.co.za"]] },
      p: { name: "Geoff Prowse", ids: [["email", "geoff@prowse.co.za"]] },
    },
    { signaturePhones: [{ contactId: "info", phone: "+27215551234" }], cards: [{ emails: ["noreply@prowse.co.za", "geoff@prowse.co.za"], phones: [] }] },
  ));
  assert.equal(r.certain.length, 0);
  assert.deepEqual(pairs(r), []);
  assert.equal(r.skipped.role, 2);
});

test("your own addresses and numbers are never merged into anyone", () => {
  const r = findMatches(world(
    {
      me: { name: "Matt", ids: [["phone", "+27820000000"], ["whatsapp", "+27820000000"]] },
      x: { name: "Matt P", ids: [["email", "matt@example.com"]] },
      y: { name: "Matt Prowse", ids: [["email", "matt.work@example.com"]] },
      z: { name: "Matt Prowse", ids: [["phone", "+27829999999"]] },
    },
    {
      own: ["matt@example.com", "+27820000000"],
      cards: [{ emails: ["matt@example.com"], phones: ["0820000000"] }],
      signaturePhones: [{ contactId: "y", phone: "+27820000000" }],
    },
  ));
  assert.equal(r.certain.length, 0);
  assert.deepEqual(pairs(r), ["y-z:same_name"]);
  assert.equal(r.skipped.own, 2);
});

test("two contacts in the same group chat are never merged or suggested", () => {
  const r = findMatches(world(
    {
      a: { name: "Sam Smith", ids: [["phone", "+27821111111"]] },
      b: { name: "Sam Smith", ids: [["whatsapp", "+27822222222"]] },
    },
    { groups: [["a", "b", "c"]], cards: [{ emails: [], phones: ["+27821111111", "+27822222222"] }] },
  ));
  assert.equal(r.certain.length, 0);
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.skipped.group, 1);
});

test("a dismissed pair is never merged or suggested again", () => {
  const input = world(
    {
      a: { name: "Geoff Prowse", ids: [["email", "geoff@prowse.co.za"]] },
      b: { name: "Geoff Prowse", ids: [["phone", "+27821234567"]] },
      c: { name: "Prowse Geoff", ids: [["email", "g@other.com"]] },
    },
    { dismissed: [["b", "a"]], cards: [{ emails: ["geoff@prowse.co.za"], phones: ["+27821234567"] }] },
  );
  const r = findMatches(input);
  assert.equal(r.certain.length, 0);
  assert.equal(r.skipped.kept_apart, 1);
  assert.deepEqual(pairs(r), ["a-c:same_name", "b-c:same_name"]);
});

test("a join that would bring a kept-apart pair together is refused, the rest still merges", () => {
  const r = findMatches(world(
    {
      a: { name: "A", ids: [["email", "a@x.com"], ["phone", "+27821111111"]] },
      b: { name: "B", ids: [["whatsapp", "+27821111111"]] },
      c: { name: "C", ids: [["phone", "+27823333333"]] },
    },
    { dismissed: [["a", "c"]], cards: [{ emails: [], phones: ["+27821111111", "+27823333333"] }] },
  ));
  assert.deepEqual(clusterSets(r), ["a,b"]);
});

test("same full name, surname first and accents, is suggested; one word names are not", () => {
  const r = findMatches(world({
    a: { name: "José Álvarez", ids: [["email", "jose@a.com"]] },
    b: { name: "ALVAREZ, Jose", ids: [["whatsapp", "+27821111111"]] },
    c: { name: "Geoff", ids: [["email", "geoff@a.com"]] },
    d: { name: "Geoff", ids: [["email", "geoff@b.com"]] },
  }));
  assert.deepEqual(pairs(r), ["a-b:same_name"]);
  assert.equal(r.suggestions[0].score, 0.75); // an email contact and a phone contact
  assert.equal(r.certain.length, 0);
});

test("a common name shared by many contacts is not suggested", () => {
  const spec: Record<string, { name: string; ids: [string, string][] }> = {};
  for (let i = 0; i < 6; i++) spec[`c${i}`] = { name: "John Smith", ids: [["email", `js${i}@x${i}.com`]] };
  assert.equal(findMatches(world(spec)).suggestions.length, 0);
});

test("an email address made of a contact's name is suggested", () => {
  const r = findMatches(world({
    e: { name: "geoff.prowse@prowse.co.za", ids: [["email", "geoff.prowse@prowse.co.za"]] },
    w: { name: "Geoff Prowse", ids: [["whatsapp", "+27821234567"]] },
    e2: { name: "GP", ids: [["email", "prowsegeoff@gmail.com"]] },
    e3: { name: "Other", ids: [["email", "gp@x.com"]] },
  }));
  assert.deepEqual(pairs(r), ["e-w:name_matches_address", "e2-w:name_matches_address"]);
  assert.ok(r.suggestions.every((s) => typeof s.evidence.identity_id === "string"));
});

test("the same name at the same organization is suggested, one word names included", () => {
  const r = findMatches(world({
    a: { name: "Thandi", org: "org1", ids: [["email", "thandi@acme.com"]] },
    b: { name: "thandi", org: "org1", ids: [["email", "thandi.m@acme.com"]] },
    c: { name: "Thandi", org: "org2", ids: [["email", "thandi@other.com"]] },
  }));
  assert.deepEqual(pairs(r), ["a-b:same_company_name"]);
});

test("certain pairs are merged, not suggested", () => {
  const r = findMatches(world({
    a: { name: "Geoff Prowse", ids: [["phone", "+27821234567"]] },
    b: { name: "Geoff Prowse", ids: [["whatsapp", "+27821234567"]] },
  }));
  assert.deepEqual(clusterSets(r), ["a,b"]);
  assert.equal(r.suggestions.length, 0);
});

test("chooseKeep: most messages, then a real name, then the oldest", () => {
  const contacts = new Map([
    ["a", { name: "+27821234567", createdAt: "2026-01-01" }],
    ["b", { name: "Geoff", createdAt: "2026-02-01" }],
    ["c", { name: "Geoff P", createdAt: "2026-03-01" }],
  ]);
  assert.equal(chooseKeep(["a", "b", "c"], new Map([["c", 9], ["a", 3]]), contacts), "c");
  assert.equal(chooseKeep(["a", "b", "c"], new Map(), contacts), "b");
  assert.equal(chooseKeep(["a", "c"], new Map(), contacts), "c");
});

test("a number on the cards of two different people joins nobody", () => {
  const r = findMatches(world(
    {
      a: { name: "Alice Smith", ids: [["email", "alice@x.com"]] },
      b: { name: "Bob Smith", ids: [["email", "bob@y.com"]] },
      h: { name: "+27215550000", ids: [["phone", "+27215550000"], ["whatsapp", "+27215550000"]] },
    },
    {
      cards: [
        { name: "Alice Smith", emails: ["alice@x.com"], phones: ["+27215550000"] },
        { name: "Bob Smith", emails: ["bob@y.com"], phones: ["021 555 0000"] },
      ],
    },
  ));
  assert.deepEqual(clusterSets(r), []);
  assert.equal(r.skipped.shared_card_keys, 1);
});

test("the same person's card in two address books still merges", () => {
  const r = findMatches(world(
    {
      a: { name: "Alice Smith", ids: [["email", "alice@x.com"]] },
      h: { name: "+27215550000", ids: [["whatsapp", "+27215550000"]] },
    },
    {
      cards: [
        { name: "Alice Smith", emails: ["alice@x.com"], phones: ["+27215550000"] },
        { name: "Smith, Alice", emails: [], phones: ["+27215550000"] },
      ],
    },
  ));
  assert.deepEqual(clusterSets(r), ["a,h"]);
});

test("two email contacts are never chained together through someone else", () => {
  const r = findMatches(world(
    {
      a: { name: "Alice Smith", ids: [["email", "alice@x.com"]] },
      b: { name: "Bob Jones", ids: [["email", "bob@y.com"]] },
      h: { name: "+27825550000", ids: [["whatsapp", "+27825550000"]] },
    },
    {
      cards: [{ name: "Alice Smith", emails: ["alice@x.com"], phones: ["+27825550000"] }],
      signaturePhones: [{ contactId: "b", phone: "082 555 0000" }],
    },
  ));
  assert.deepEqual(clusterSets(r), ["a,h"]);
  assert.equal(r.skipped.conflicts, 1);
});

test("role addresses with separators, suffixes and tags", () => {
  for (const a of ["no_reply@x.com", "do_not_reply@x.com", "info.za@x.com", "support-za@x.com", "hello+news@x.com",
    "accounts-payable@x.com", "do-not-respond@x.com", "orders.noreply@x.com"]) {
    assert.ok(isRoleAddress(a), a);
  }
  for (const a of ["geoff+shop@x.com", "jo_smith@x.com", "information.officer.jones@x.com", "hi.jo@x.com"]) assert.ok(!isRoleAddress(a), a);
});
