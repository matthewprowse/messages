// Tests for lib/contact-import.ts and lib/contact-export.ts: reading vCard and CSV, writing them back, and planning an import
// against the contacts already held.

import test from "node:test";
import assert from "node:assert/strict";
import { parseContactFile, parseCsv, parseCsvRows, parseVcards, planImport, summarisePlan, type ImportRow } from "./contact-import";
import { safeCell, toCsv, toVcard, toVcards, type ExportContact } from "./contact-export";

const contact: ExportContact = {
  name: "Sipho Dlamini", emails: ["sipho@firm.co.za", "s@home.com"], phones: ["+27821234567"], company: "Dlamini & Co", role: "Attorney",
  relationship: "Client", about: "Calls her Mpho; prefers WhatsApp,\nsecond line", vip: true,
};

test("a vCard written by us reads back the same", () => {
  const [row] = parseVcards(toVcard(contact));
  assert.deepEqual(row, { ...contact });
});

test("vCards from address books: folded lines, group prefixes, several cards and a name only in N", () => {
  const file = [
    "BEGIN:VCARD", "VERSION:3.0", "N:Naidoo;Priya;;;", "item1.EMAIL;type=INTERNET;type=WORK:Priya@Naidoo.co.za", "TEL;TYPE=CELL:082 555",
    " 0101", "ORG:Naidoo Properties;Sales", "END:VCARD",
    "BEGIN:VCARD", "FN:Nobody", "END:VCARD",
    "BEGIN:VCARD", "END:VCARD",
  ].join("\r\n");
  const rows = parseVcards(file);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].name, rows[0].emails, rows[0].phones, rows[0].company], ["Priya Naidoo", ["priya@naidoo.co.za"], ["082 5550101"], "Naidoo Properties"]);
  assert.equal(rows[1].name, "Nobody");
});

test("long lines are folded and unfolded without losing text", () => {
  const long = { ...contact, about: "x".repeat(300) };
  const card = toVcard(long);
  assert.ok(card.split("\r\n").every((l) => l.length <= 75));
  assert.equal(parseVcards(card)[0].about, long.about);
});

test("a CSV written by us reads back the same, quotes and line breaks included", () => {
  const csv = toCsv([contact, { ...contact, name: 'Anna "AJ" Jones', emails: [], phones: [], about: "", vip: false }]);
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { ...contact });
  assert.equal(rows[1].name, 'Anna "AJ" Jones');
  assert.equal(rows[1].vip, false);
});

test("a name that looks like a formula is exported safely and imported as written", () => {
  assert.equal(safeCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(safeCell("+27821234567"), "+27821234567");
  assert.equal(safeCell("-cmd|calc"), "'-cmd|calc");
  const [row] = parseCsv(toCsv([{ ...contact, name: "=HYPERLINK(1)" }]));
  assert.equal(row.name, "=HYPERLINK(1)");
});

test("a semicolon file and a Google style header with label columns", () => {
  assert.equal(parseCsvRows("a;b;c\n1;2;3").length, 2);
  const csv = ["First Name,Last Name,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Value,Organization 1 - Name,Organization 1 - Title,Notes", "Lerato,Mokoena,Work,Lerato@Firm.co.za,0821112222,Firm,Partner,Met at the expo"].join("\n");
  const [row] = parseCsv(csv);
  assert.deepEqual([row.name, row.emails, row.phones, row.company, row.role, row.about], ["Lerato Mokoena", ["lerato@firm.co.za"], ["0821112222"], "Firm", "Partner", "Met at the expo"]);
});

test("a file with no usable header gives nothing, and the format is told by its first line", () => {
  assert.deepEqual(parseCsv("foo,bar\n1,2"), []);
  assert.equal(parseContactFile(toVcards([contact])).length, 1);
  assert.equal(parseContactFile(toCsv([contact])).length, 1);
});

const known = [
  { id: "a", name: "Sipho D", emails: ["sipho@firm.co.za"], phones: [] },
  { id: "b", name: "Priya", emails: [], phones: ["+27825550101"] },
];
const row = (over: Partial<ImportRow>): ImportRow => ({ name: "", emails: [], phones: [], company: "", role: "", relationship: "", about: "", vip: false, ...over });

test("a row sharing an address or number merges and adds only what is missing", () => {
  const plan = planImport([
    row({ name: "Sipho Dlamini", emails: ["sipho@firm.co.za", "s@home.com"], phones: ["082 123 4567"] }),
    row({ name: "Priya Naidoo", emails: ["priya@naidoo.co.za"], phones: ["082 555 0101"] }),
  ], known, "27");
  assert.deepEqual(plan.map((p) => [p.action, p.target?.id]), [["merge", "a"], ["merge", "b"]]);
  assert.deepEqual([plan[0].emails, plan[0].phones], [["s@home.com"], ["+27821234567"]]);
  assert.deepEqual([plan[1].emails, plan[1].phones], [["priya@naidoo.co.za"], []]);
});

test("new people are created, repeats and empty rows are skipped, and a bad number is dropped with a note", () => {
  const plan = planImport([
    row({ name: "Thandi", emails: ["t@x.com"], phones: ["not a number"] }),
    row({ name: "Thandi again", emails: ["t@x.com"] }),
    row({ emails: ["only@address.com"] }),
    row({ company: "No contact details" }),
  ], known, "27");
  assert.deepEqual(plan.map((p) => p.action), ["create", "skip", "create", "skip"]);
  assert.match(plan[0].note ?? "", /could not be read/);
  assert.equal(plan[2].name, "only@address.com");
  assert.deepEqual(summarisePlan(plan), { create: 2, merge: 0, skip: 2 });
});
