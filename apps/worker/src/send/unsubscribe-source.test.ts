// Tests for send/unsubscribe-source.ts: an authenticated email's header beats a newer forged one, and a request runs
// only on its own person's account.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isVouched, mayUnsubscribe, pickUnsubscribeSource } from "./unsubscribe-source";

const row = (header: string, auth?: unknown) => ({ list_unsubscribe: header, list_unsubscribe_post: false, auth });

test("the newest email the sender's domain vouched for is used before a newer unsigned one", () => {
  const forged = row("forged", { spf: "pass", dkim: "fail", dmarc: "fail" });
  const real = row("real", { dmarc: "pass" });
  const older = row("older", { dkim: "pass", dkim_domain: "mail.news.example" });
  assert.equal(pickUnsubscribeSource([forged, real, older], "news.example")?.list_unsubscribe, "real");
  assert.equal(pickUnsubscribeSource([forged, older], "news.example")?.list_unsubscribe, "older");
});

test("with no verdicts at all the newest email is used", () => {
  assert.equal(pickUnsubscribeSource([row("new"), row("old", null)])?.list_unsubscribe, "new");
  assert.equal(pickUnsubscribeSource([]), null);
});

test("only a pass vouches", () => {
  assert.equal(isVouched({ dmarc: "pass" }), true);
  assert.equal(isVouched({ dkim: "pass", dkim_domain: "news.example", dmarc: "fail" }, "news.example"), true);
  for (const bad of [null, undefined, "pass", { spf: "pass" }, { dmarc: "bestguesspass" }, { dkim: "neutral" }, { dkim: "pass" }]) assert.equal(isVouched(bad, "news.example"), false);
});

test("an unsubscribe runs only on its own account, for the person who owns it", () => {
  const request = { account_id: "acc1", user_id: "u1" };
  assert.equal(mayUnsubscribe(request, "acc1", "u1"), true);
  assert.equal(mayUnsubscribe(request, "acc2", "u1"), false);
  assert.equal(mayUnsubscribe(request, "acc1", "u2"), false);
  assert.equal(mayUnsubscribe(request, "acc1", null), false);
});

test("a DKIM pass vouches only when the sender's own organisation signed", () => {
  const rows = [
    { list_unsubscribe: "<https://attacker.example/u>", list_unsubscribe_post: true, auth: { dkim: "pass", dkim_domain: "attacker.example" } },
    { list_unsubscribe: "<https://news.example/u>", list_unsubscribe_post: true, auth: { dkim: "pass", dkim_domain: "mail.news.example" } },
  ];
  assert.equal(pickUnsubscribeSource(rows, "news.example")?.list_unsubscribe, "<https://news.example/u>");
  assert.equal(isVouched({ dkim: "pass", dkim_domain: "attacker.example" }, "news.example"), false);
  assert.equal(isVouched({ dkim: "pass" }, "news.example"), false, "an older row without the signing domain is not a vouch");
  assert.equal(isVouched({ dkim: "pass", dkim_domain: "news.example" }, null), false, "with no From domain only DMARC counts");
  assert.equal(isVouched({ dmarc: "pass" }, null), true);
});
