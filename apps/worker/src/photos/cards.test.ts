// Tests for cards.ts: vCard 3.0 and 4.0 parsing (folded photos, escapes), CardDAV multistatus extraction, phone
// keys, and matching cards to contacts by email then phone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCards, parseVCard, phoneKey, vcardsFromMultistatus } from "./cards";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

test("vCard 3.0 with a folded base64 photo, grouped emails and phones", () => {
  const b64 = jpeg.toString("base64");
  const card = parseVCard(
    ["BEGIN:VCARD", "VERSION:3.0", "FN:Sam Jones", "item1.EMAIL;type=INTERNET:Sam@Example.com", "TEL;type=CELL:081 234 5678",
      `PHOTO;ENCODING=b;TYPE=JPEG:${b64.slice(0, 4)}`, ` ${b64.slice(4)}`, "END:VCARD"].join("\r\n"),
  );
  assert.equal(card.name, "Sam Jones");
  assert.deepEqual(card.emails, ["sam@example.com"]);
  assert.deepEqual(card.phones, ["081 234 5678"]);
  assert.deepEqual(card.photo, { bytes: jpeg });
});

test("vCard 4.0 data URI and remote photos", () => {
  assert.deepEqual(parseVCard(`BEGIN:VCARD\nPHOTO:data:image/jpeg;base64,${jpeg.toString("base64")}\nEND:VCARD`).photo, { bytes: jpeg });
  assert.deepEqual(parseVCard("BEGIN:VCARD\nPHOTO;VALUE=uri:https://p1-contacts.icloud.com/p.jpg\nEND:VCARD").photo, { url: "https://p1-contacts.icloud.com/p.jpg" });
  assert.equal(parseVCard("BEGIN:VCARD\nFN:No Photo\nEND:VCARD").photo, null);
});

test("vCards come out of a CardDAV multistatus, escaped or in CDATA", () => {
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
    <d:response><d:propstat><d:prop><card:address-data>BEGIN:VCARD&#13;
EMAIL:a&amp;b@x.com&#13;
END:VCARD</card:address-data></d:prop></d:propstat></d:response>
    <d:response><d:propstat><d:prop><address-data xmlns="urn:ietf:params:xml:ns:carddav"><![CDATA[BEGIN:VCARD
EMAIL:c@x.com
END:VCARD]]></address-data></d:prop></d:propstat></d:response></d:multistatus>`;
  const cards = vcardsFromMultistatus(xml).map(parseVCard);
  assert.deepEqual(cards.map((c) => c.emails), [["a&b@x.com"], ["c@x.com"]]);
});

test("phone keys match local and international forms", () => {
  assert.equal(phoneKey("081 234 5678"), phoneKey("+27812345678"));
  assert.equal(phoneKey("12"), null);
});

test("cards match by email first, then phone, and ambiguous matches are skipped", () => {
  const photo = { bytes: jpeg };
  const identities = [
    { contact_id: "A", kind: "email", value: "sam@example.com" },
    { contact_id: "B", kind: "phone", value: "+27812345678" },
    { contact_id: "B", kind: "whatsapp", value: "+27812345678" },
    { contact_id: "C", kind: "phone", value: "+27820000001" },
    { contact_id: "D", kind: "phone", value: "+44820000001" }, // same last nine digits as C
    { contact_id: "E", kind: "whatsapp", value: "99912345678@lid" }, // a privacy ID, never a phone
  ];
  const result = matchCards(
    [
      { name: "Sam", emails: ["sam@example.com"], phones: ["0812345678"], photo }, // email wins: A
      { name: "Bo", emails: [], phones: ["081 234 5678"], photo: null }, // B, a name with no photo still matches
      { name: null, emails: [], phones: ["0820000001"], photo }, // C or D: skipped
      { name: null, emails: ["nobody@example.com"], phones: [], photo: null }, // nobody
    ],
    identities,
  );
  assert.deepEqual(result.map((r) => r.contactId).sort(), ["A", "B"]);
});

test("escaped commas and semicolons in saved names", () => {
  assert.equal(parseVCard("BEGIN:VCARD\nFN:Jones\\, Sam\nEND:VCARD").name, "Jones, Sam");
});
