// Tests for send/unsubscribe.ts: List-Unsubscribe parsing (https and mailto only), body link detection, private address refusal and the one-click request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyUnsubscribeLink, isPrivateAddress, oneClickUnsubscribe, parseListUnsubscribe, UNSUBSCRIBE_BODY, UNSUBSCRIBE_SUBJECT } from "./unsubscribe";

test("reads https and mailto options", () => {
  const o = parseListUnsubscribe("<mailto:leave@list.example?subject=Remove%20me>, <https://list.example/u/abc>");
  assert.equal(o.https, "https://list.example/u/abc");
  assert.deepEqual(o.mailto, { to: "leave@list.example", subject: UNSUBSCRIBE_SUBJECT, body: UNSUBSCRIBE_BODY });
});

test("a mailto unsubscribe goes to exactly one address, with our own subject and body", () => {
  const o = parseListUnsubscribe("<mailto:Leave-Token@list.example?subject=Wire%20money&body=Click%20this&cc=boss@x.com>");
  assert.deepEqual(o.mailto, { to: "Leave-Token@list.example", subject: "Unsubscribe", body: "Unsubscribe" });
  for (const bad of ["<mailto:a@x.com,b@x.com>", "<mailto:a@x.com%2Cb@x.com>", "<mailto:a@x.com;b@x.com>", "<mailto:%E0%A4%A>", `<mailto:${"a".repeat(250)}@x.com>`, "<mailto:a@x.com%0D%0ABcc:b@x.com>"]) {
    assert.equal(parseListUnsubscribe(bad).mailto, null, bad);
  }
});

test("ignores http and junk entries", () => {
  const o = parseListUnsubscribe("<http://plain.example/u>, <javascript:alert(1)>, nonsense");
  assert.equal(o.https, null);
  assert.equal(o.mailto, null);
});

test("private addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::FFFF:7F00:0001", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "2002:a9fe:a9fe::1", "fe80::1", "0.0.0.0", "not an ip"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:808:808"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("MIME-encoded headers are decoded first", () => {
  const encoded = "=?us-ascii?Q?<https://u.example/x=3Fa=3D1>,?= =?us-ascii?Q?_<mailto:out@u.example>?=";
  const o = parseListUnsubscribe(encoded);
  assert.equal(o.https, "https://u.example/x?a=1");
  assert.equal(o.mailto?.to, "out@u.example");
});

test("finds an unsubscribe link in the text for you to open", () => {
  assert.equal(bodyUnsubscribeLink("Help: www.x.com/help\n  Unsubscribe: www.pinterest.com/email/click/?a=1"), "https://www.pinterest.com/email/click/?a=1");
  assert.equal(bodyUnsubscribeLink("Manage: https://news.example/unsubscribe?id=9 today"), "https://news.example/unsubscribe?id=9");
  assert.equal(bodyUnsubscribeLink("Unsubscribe: http://plain.example/u"), null);
  assert.equal(bodyUnsubscribeLink("Nothing here"), null);
  assert.equal(bodyUnsubscribeLink("To unsubscribe,\nvisit https://news.example/x"), null);
  assert.equal(bodyUnsubscribeLink(`Unsubscribe ${"x".repeat(41)} https://news.example/x`), null);
  assert.equal(bodyUnsubscribeLink("Go to xhttps://a.example/unsubscribe/1 now"), "https://a.example/unsubscribe/1");
  assert.equal(bodyUnsubscribeLink("Unsubscribe unsubscribe Unsubscribe: WWW.News.example/u"), "https://www.news.example/u");
});

test("a link at the very end of a long email is still found", () => {
  assert.equal(bodyUnsubscribeLink(`${"Hello there. ".repeat(20_000)}Unsubscribe: https://news.example/u`), "https://news.example/u");
});

test("pathological text is scanned in linear time", () => {
  const inputs = [
    "https://" + "www.".repeat(250_000),
    "www." + "https://".repeat(120_000),
    "https://" + "unsubscribe".repeat(90_000),
    "unsubscribe".repeat(90_000),
    "unsubscribe ".repeat(80_000) + "www.".repeat(50_000),
    ("www.x" + "a".repeat(30) + " ").repeat(25_000),
  ];
  for (const text of inputs) {
    const started = performance.now();
    bodyUnsubscribeLink(text);
    const ms = performance.now() - started;
    assert.ok(ms < 250, `${text.slice(0, 20)}... took ${Math.round(ms)} ms`);
  }
});

test("one-click connects to the pinned address, not a second lookup", async () => {
  let posted: { address: string; host: string } | null = null;
  const out = await oneClickUnsubscribe("https://list.example/u/1", {
    resolve: async () => "93.184.216.34",
    post: async (target, address) => {
      posted = { address, host: target.host };
      return 200;
    },
  });
  assert.deepEqual(out, { ok: true, status: 200 });
  assert.deepEqual(posted, { address: "93.184.216.34", host: "list.example" });
});

test("one-click refuses http, private hosts and IP literals", async () => {
  const post = async () => {
    throw new Error("must not connect");
  };
  assert.equal((await oneClickUnsubscribe("http://list.example/u", { resolve: async () => "8.8.8.8", post })).ok, false);
  assert.equal((await oneClickUnsubscribe("https://rebind.example/u", { resolve: async () => null, post })).ok, false);
  for (const u of ["https://127.0.0.1/u", "https://169.254.169.254/latest", "https://[::ffff:7f00:1]/u", "https://[64:ff9b::7f00:1]/u", "https://[2002:7f00:1::]/u"]) {
    assert.equal((await oneClickUnsubscribe(u, { post })).ok, false, u);
  }
});

test("one-click does not follow redirects and counts 3xx as done", async () => {
  assert.equal((await oneClickUnsubscribe("https://list.example/u", { resolve: async () => "8.8.8.8", post: async () => 302 })).ok, true);
  assert.equal((await oneClickUnsubscribe("https://list.example/u", { resolve: async () => "8.8.8.8", post: async () => 500 })).ok, false);
});
