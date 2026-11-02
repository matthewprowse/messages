// Tests for map-contact.ts: initials, and sorting a contact's identities into emails, phones, handles and hidden ids.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mapContact } from "./map-contact";

const row = (name: string) => ({ id: "c", display_name: name, company: null, role: null, avatar_path: null, organizations: null });

test("initials are the first and last word, and a blank name is a question mark", () => {
  assert.equal(mapContact(row("Ada Lovelace King"), []).initials, "AK");
  assert.equal(mapContact(row("ada"), []).initials, "A");
  assert.equal(mapContact(row("  "), []).initials, "?");
});

test("identities are sorted by kind, and a hidden WhatsApp id is not a phone number", () => {
  const c = mapContact(row("Ada"), [
    { kind: "email", value: "a@x.com" },
    { kind: "phone", value: "+27821234567" },
    { kind: "whatsapp", value: "999@lid" },
    { kind: "instagram_username", value: "ada" },
  ]);
  assert.deepEqual(c.emails, ["a@x.com"]);
  assert.deepEqual(c.phones, ["+27821234567"]);
  assert.deepEqual(c.lids, ["999@lid"]);
  assert.deepEqual(c.handles, ["ada"]);
  assert.equal(mapContact(row("Bo"), []).handles, undefined);
});
