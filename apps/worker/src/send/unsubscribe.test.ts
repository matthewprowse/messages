import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyUnsubscribeLink, isPrivateAddress, parseListUnsubscribe } from "./unsubscribe";

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
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
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
