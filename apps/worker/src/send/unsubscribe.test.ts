import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyUnsubscribeLink, isPrivateAddress, oneClickUnsubscribe, parseListUnsubscribe } from "./unsubscribe";

test("reads https and mailto options", () => {
  const o = parseListUnsubscribe("<mailto:leave@list.example?subject=Remove%20me>, <https://list.example/u/abc>");
  assert.equal(o.https, "https://list.example/u/abc");
  assert.deepEqual(o.mailto, { to: "leave@list.example", subject: "Remove me", body: "unsubscribe" });
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
