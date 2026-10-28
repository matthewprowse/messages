// Tests for import-plan.ts: which address book cards create, update or are skipped as ambiguous or your own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { toE164 } from "../contacts/signature-phones";
import type { Card } from "./cards";
import { importRows } from "./import-plan";

const toRow = (c: Card) => ({ name: c.name, emails: c.emails, phones: c.phones.map((p) => toE164(p, "27") ?? p) });

const card = (name: string | null, phones: string[], emails: string[] = []) => ({ name, emails, phones, photo: null });

test("new people are created, known people updated, ambiguous cards and your own card left out", () => {
  const identities = [
    { contact_id: "A", kind: "phone", value: "+27812345678" },
    { contact_id: "B", kind: "phone", value: "+27820000001" },
    { contact_id: "C", kind: "phone", value: "+27830000002" },
    { contact_id: "D", kind: "email", value: "d@x.com" },
  ];
  const rows = importRows(
    [
      card("Devin Smith", ["081 234 5678"]), // A, by local number
      card("New Person", ["082 999 9999"]), // nobody: created
      card("Two People", ["082 000 0001"], ["d@x.com"]), // email wins: D only
      card("Me", ["+27815956488"]), // you
      card("Spans", ["083 000 0002", "082 000 0001"], ["c@x.com"]), // no email match; phone matches B and C: linker's job
    ],
    identities,
    toRow,
    new Set(["+27815956488"]),
  );
  assert.deepEqual(rows, [
    { contact_id: "A", name: "Devin Smith", emails: [], phones: ["+27812345678"] },
    { contact_id: null, name: "New Person", emails: [], phones: ["+27829999999"] },
    { contact_id: "D", name: "Two People", emails: ["d@x.com"], phones: ["+27820000001"] },
  ]);
});

test("two cards for one person update neither", () => {
  const identities = [{ contact_id: "A", kind: "phone", value: "+27812345678" }];
  const rows = importRows([card("Dev", ["0812345678"]), card("Devin", ["+27 81 234 5678"])], identities, toRow, new Set());
  assert.deepEqual(rows, []);
});
