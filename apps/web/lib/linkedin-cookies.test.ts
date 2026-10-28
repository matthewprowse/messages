import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanProxy, fromCookieHeader, fromCurl, fromPaste, fromValues } from "./linkedin-cookies";

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

test("a proxy is an http, https or socks5 address, not this machine or a private network", () => {
  assert.equal(cleanProxy(" http://user:pa%24s@proxy.example.com:8080 "), "http://user:pa%24s@proxy.example.com:8080");
  assert.equal(cleanProxy("socks5://proxy.example.com:1080/"), "socks5://proxy.example.com:1080");
  assert.equal(cleanProxy("https://203.0.113.7:3128"), "https://203.0.113.7:3128");
  for (const bad of [
    "", "proxy.example.com:8080", "ftp://proxy.example.com", "http://", "http://localhost:8080", "http://127.0.0.1:8080", "http://10.0.0.5:3128",
    "http://192.168.1.2:3128", "http://172.20.0.1:3128", "http://169.254.169.254", "http://[::1]:8080", "http://intranet", "http://db.internal:5432",
    "http://proxy.example.com/path?x=1", "javascript:alert(1)", "http://[::ffff:7f00:1]:80", "http://[64:ff9b::7f00:1]", "http://[2002:7f00:1::]",
  ]) assert.equal(cleanProxy(bad), null, bad);
});
