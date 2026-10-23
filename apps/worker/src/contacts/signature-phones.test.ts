import { test } from "node:test";
import assert from "node:assert/strict";
import { countryCodeOf, ownText, signaturePhones, toE164 } from "./signature-phones";

test("toE164: local, international and formatted numbers", () => {
  assert.equal(toE164("082 123 4567"), "+27821234567");
  assert.equal(toE164("(021) 555-1234"), "+27215551234");
  assert.equal(toE164("+27 82 123 4567"), "+27821234567");
  assert.equal(toE164("0027 82 123 4567"), "+27821234567");
  assert.equal(toE164("27821234567"), "+27821234567");
  assert.equal(toE164("+44 (0)20 7946 0018"), "+442079460018");
  assert.equal(toE164("020 7946 0018", "44"), "+442079460018");
  assert.equal(toE164("tel:+1-415-555-0134"), "+14155550134");
  assert.equal(toE164("(415) 555-0134", "1"), "+14155550134");
  assert.equal(toE164("+27 21 555 1234 ext. 204"), "+27215551234");
});

test("toE164: refuses what is not a phone number", () => {
  assert.equal(toE164("12345678901@lid"), null);
  assert.equal(toE164("821234567"), null); // no trunk zero and no country code: unknown
  assert.equal(toE164("555 1234"), null);
  assert.equal(toE164("+0 82 123 4567"), null);
  assert.equal(toE164("Call me"), null);
  assert.equal(toE164("0821234567", "1"), null);
});

test("countryCodeOf: one, two and three digit codes", () => {
  assert.equal(countryCodeOf("+27821234567"), "27");
  assert.equal(countryCodeOf("+14155550134"), "1");
  assert.equal(countryCodeOf("+447700900123"), "44");
  assert.equal(countryCodeOf("+353861234567"), "353");
  assert.equal(countryCodeOf("+79161234567"), "7");
  assert.equal(countryCodeOf(null), null);
  assert.equal(countryCodeOf("123"), null);
});

test("finds the number after a sign-off", () => {
  const text = ["Hi Matt,", "", "See you Thursday.", "", "Kind regards,", "Geoff Prowse", "Director, Prowse & Co", "082 123 4567"].join("\n");
  assert.deepEqual(signaturePhones(text), ["+27821234567"]);
});

test("finds labelled numbers, skips fax, keeps both mobile and office", () => {
  const text = [
    "Morning,",
    "Attached is the quote.",
    "--",
    "Sam Jones | Acme",
    "T: +27 21 555 1234 | M: 083 555 6789 | Fax: 021 555 9999",
  ].join("\n");
  assert.deepEqual(signaturePhones(text).sort(), ["+27215551234", "+27835556789"]);
});

test("a labelled number in the body counts even far from the end", () => {
  const body = ["Please call me, Cell: 072 000 1111, when you land.", ...Array.from({ length: 30 }, (_, i) => `Line ${i} of the itinerary`)];
  assert.deepEqual(signaturePhones(body.join("\n")), ["+27720001111"]);
});

test("an unlabelled number high up in a long email is not a signature", () => {
  const body = ["The reference was 0821234567 I think", ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i}`)];
  assert.deepEqual(signaturePhones(body.join("\n")), []);
});

test("ignores dates, prices, order numbers, postcodes and short numbers", () => {
  const text = [
    "Thanks,",
    "Jo",
    "Order number: 0012345678",
    "Invoice #0823456789",
    "Date: 2026/10/23",
    "Delivered 23.10.2026",
    "Total R 1 250 000",
    "Amount due 1234567.89",
    "Cape Town 8001",
    "Ext 1234",
    "Reg 2015/123456/07",
    "Tracking 0831234567",
    "20261023",
  ].join("\n");
  assert.deepEqual(signaturePhones(text), []);
});

test("quoted replies are left out, so another person's signature is never read", () => {
  const text = [
    "Sounds good.",
    "",
    "On Tue, 21 Oct 2026 at 09:12, Sarah Smith <sarah@example.com> wrote:",
    "> Let me know.",
    "> Regards,",
    "> Sarah",
    "> 082 999 8888",
  ].join("\n");
  assert.deepEqual(signaturePhones(text), []);
  const outlook = ["Done", "", "________________________________", "From: Sarah", "Sent: Tuesday", "Cell: 082 999 8888"].join("\n");
  assert.deepEqual(signaturePhones(outlook), []);
  const wrapped = ["Yes", "On Tue, 21 Oct 2026 at 09:12, Sarah Smith <sarah@example.com>", "wrote:", "Mobile 082 999 8888"].join("\n");
  assert.deepEqual(signaturePhones(wrapped), []);
  assert.deepEqual(ownText("a\n-----Original Message-----\nb"), ["a"]);
});

test("uses the user's country for local numbers", () => {
  const text = "Cheers,\nTom\nMobile: 07700 900123";
  assert.deepEqual(signaturePhones(text, "44"), ["+447700900123"]);
  assert.deepEqual(signaturePhones(text, "27"), ["+277700900123"]);
});

test("international numbers in a signature and duplicates", () => {
  const text = "Best,\nAna\n+351 912 345 678\nWhatsApp: +351 912 345 678";
  assert.deepEqual(signaturePhones(text), ["+351912345678"]);
});

test("empty and missing text", () => {
  assert.deepEqual(signaturePhones(null), []);
  assert.deepEqual(signaturePhones(""), []);
  assert.deepEqual(signaturePhones("Hello"), []);
});

test("a number in a sentence about someone else is never the sender's", () => {
  const colleague = "Hi Matt,\n\nYou can reach my colleague Jane on 082 555 1234 about the lease.\n\nThanks\nGeoff";
  assert.deepEqual(signaturePhones(colleague), []);
  assert.deepEqual(signaturePhones("Hi,\n\nPlease call my wife on 082 555 1234\n\nGeoff"), []);
  assert.deepEqual(signaturePhones("Thanks!\n\nJane's number is 082 555 1234\n\nGeoff"), []);
  assert.deepEqual(signaturePhones("Hi,\nCall Jane on mobile: 082 555 1234\nGeoff"), []);
  assert.deepEqual(signaturePhones("Short note\nGeoff\n082 555 1234"), []); // unlabelled and no sign-off
  assert.deepEqual(signaturePhones("Regards,\nGeoff\nPhone number: 082 555 1234"), ["+27825551234"]);
});

test("reply headers in other languages are left out", () => {
  const sig = ["", "Jane Doe", "Mobile: 082 555 1234"];
  for (const header of [
    "Op Di., 20 Okt. 2026 om 10:00 het Jane Doe <j@x.com> geskryf:",
    "Op di 20 okt 2026 om 10:00 schreef Jane Doe <j@x.com>:",
    "Am Di., 20. Okt. 2026 um 10:00 Uhr schrieb Jane Doe <j@x.com>:",
    "Le mar. 20 oct. 2026 à 10:00, Jane Doe <j@x.com> a écrit :",
    "El mar, 20 oct 2026 a las 10:00, Jane Doe (<j@x.com>) escribió:",
    "Jane Doe <j@x.com>:",
  ]) {
    assert.deepEqual(signaturePhones(["Sure.", "", "Geoff", "", header, ...sig].join("\n")), [], header);
  }
  const wrapped = ["Sure.", "Op Di., 20 Okt. 2026 om 10:00 het Jane Doe <j@x.com>", "geskryf:", ...sig].join("\n");
  assert.deepEqual(signaturePhones(wrapped), []);
});
