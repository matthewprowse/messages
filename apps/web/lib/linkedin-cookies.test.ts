import { test } from "node:test";
import assert from "node:assert/strict";
import { fromCookieHeader, fromCurl, fromPaste, fromValues } from "./linkedin-cookies";

// Made-up values in the shapes browsers copy.
const LI_AT = "AQEDAR" + "x".repeat(40);

test("li_at and JSESSIONID on their own, with or without quotes", () => {
  assert.deepEqual(fromValues(` ${LI_AT} `, '"ajax:1234567890"'), { cookies: `li_at=${LI_AT}; JSESSIONID="ajax:1234567890"` });
  assert.deepEqual(fromValues(LI_AT, "ajax:1234567890"), { cookies: `li_at=${LI_AT}; JSESSIONID="ajax:1234567890"` });
  assert.equal(fromValues("short", "ajax:1"), null);
  assert.equal(fromValues(LI_AT, "not-a-session"), null);
  assert.equal(fromValues(`${LI_AT}; other=1`, "ajax:1"), null);
});

test("a Copy as cURL (bash) with the cookie header and LinkedIn's own headers", () => {
  const curl = `curl 'https://www.linkedin.com/voyager/api/me' \\
  -H 'accept: application/vnd.linkedin.normalized+json+2.1' \\
  -H 'cookie: bcookie="v=2&abc"; li_at=${LI_AT}; JSESSIONID="ajax:1234567890"; lang=v=2&lang=en-us' \\
  -H 'x-li-page-instance: urn:li:page:d_flagship3_messaging;abc==' \\
  -H 'x-li-track: {"clientVersion":"1.13.1","mpName":"voyager-web"}'`;
  const session = fromCurl(curl);
  assert.ok(session);
  assert.equal(session.cookies, `bcookie="v=2&abc"; li_at=${LI_AT}; JSESSIONID="ajax:1234567890"; lang=v=2&lang=en-us`);
  assert.equal(session.xLiTrack, '{"clientVersion":"1.13.1","mpName":"voyager-web"}');
  assert.equal(session.pageInstance, "urn:li:page:d_flagship3_messaging;abc==");
});

test("cookies given with -b, as Firefox copies them", () => {
  const session = fromCurl(`curl 'https://www.linkedin.com/messaging/' -b 'li_at=${LI_AT}; JSESSIONID="ajax:42"'`);
  assert.equal(session?.cookies, `li_at=${LI_AT}; JSESSIONID="ajax:42"`);
});

test("double-quoted arguments, with escaped quotes inside", () => {
  const session = fromCurl(`curl "https://www.linkedin.com/feed/" -H "cookie: li_at=${LI_AT}; JSESSIONID=\\"ajax:42\\""`);
  assert.equal(session?.cookies, `li_at=${LI_AT}; JSESSIONID="ajax:42"`);
});

test("anything without a LinkedIn session is refused", () => {
  assert.equal(fromCurl(`curl 'https://example.com' -H 'cookie: li_at=${LI_AT}; JSESSIONID="ajax:1"'`), null);
  assert.equal(fromCurl(`curl 'https://www.linkedin.com/feed/' -H 'cookie: lang=en'`), null);
  assert.equal(fromCookieHeader(`li_at=${LI_AT}`), null);
});

test("the cURL box also takes a bare Cookie header", () => {
  assert.equal(fromPaste(`Cookie: li_at=${LI_AT}; JSESSIONID="ajax:7"`)?.cookies, `li_at=${LI_AT}; JSESSIONID="ajax:7"`);
  assert.ok(fromPaste(`curl 'https://www.linkedin.com/' -H 'cookie: li_at=${LI_AT}; JSESSIONID=ajax:7'`));
});
