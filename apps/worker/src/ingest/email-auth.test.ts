// Tests for ingest/email-auth.ts: reading SPF, DKIM and DMARC verdicts from Authentication-Results (Gmail, Microsoft and
// forged copies), and when mail from your own address counts as yours.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnMail, parseAuthResults } from "./email-auth";

const gmail =
  "mx.google.com; dkim=pass header.i=@news.example header.s=s1 header.b=AbC; spf=pass (google.com: domain of x@news.example designates 1.2.3.4 as permitted sender; really) smtp.mailfrom=x@news.example; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=news.example";
const microsoft =
  "spf=softfail (sender IP is 1.2.3.4) smtp.mailfrom=bank.example; dkim=none (message not signed) header.d=none;dmarc=FAIL action=quarantine header.from=bank.example;compauth=fail reason=000";

test("verdicts are read as lowercase code words", () => {
  assert.deepEqual(parseAuthResults([gmail]), { spf: "pass", dkim: "pass", dmarc: "pass", dkim_domain: "news.example" });
  assert.deepEqual(parseAuthResults([microsoft]), { spf: "softfail", dkim: "none", dmarc: "fail" });
});

test("only the topmost header counts: a sender's forged copy sits below the server's", () => {
  const forged = "mx.google.com; dmarc=pass header.from=bank.example";
  assert.deepEqual(parseAuthResults([microsoft, forged]), { spf: "softfail", dkim: "none", dmarc: "fail" });
});

test("missing methods are left out, and no header or no verdict gives null", () => {
  assert.deepEqual(parseAuthResults(["mx.example; spf=neutral smtp.mailfrom=a.example"]), { spf: "neutral" });
  assert.equal(parseAuthResults([]), null);
  assert.equal(parseAuthResults(["mx.example; none"]), null);
  assert.equal(parseAuthResults(["mx.example; arc=pass; compauth=pass"]), null);
});

test("unknown words and comment text are never stored", () => {
  assert.equal(parseAuthResults(["mx.example; spf=hello-there; dmarc=<script>"]), null);
  assert.deepEqual(parseAuthResults(["mx.example (dmarc=pass; spf=pass); dkim=fail"]), { dkim: "fail" });
});

test("one DKIM signature that verified is enough", () => {
  assert.deepEqual(parseAuthResults(["mx.example; dkim=fail header.d=a.example; dkim=pass header.d=b.example"]), { dkim: "pass", dkim_domain: "b.example" });
});

test("your own address in From makes inbox mail yours only when DMARC passed", () => {
  const self = new Set(["me@prowse.co.za"]);
  assert.equal(isOwnMail("sent", "someone@x.com", self, null), true);
  assert.equal(isOwnMail("inbox", "me@prowse.co.za", self, null), false);
  assert.equal(isOwnMail("inbox", "me@prowse.co.za", self, { spf: "pass", dkim: "pass", dmarc: "fail" }), false);
  assert.equal(isOwnMail("inbox", "me@prowse.co.za", self, { dmarc: "pass" }), true);
  assert.equal(isOwnMail("inbox", "julia@x.com", self, { dmarc: "pass" }), false);
  assert.equal(isOwnMail("archive", "me@prowse.co.za", self, null), true);
  assert.equal(isOwnMail("inbox", null, self, null), false);
});

import { authservIdOf, authservTrust, dkimAligned, nameMismatch, organisationOf } from "./email-auth";

test("a header from a server that is not the provider counts for nothing", () => {
  const forgedOnTop = "mail.attacker.example; dmarc=pass header.from=bank.example";
  assert.equal(parseAuthResults([forgedOnTop], authservTrust("gmail")), null, "a sender's copy left on top by a server that adds none");
  assert.deepEqual(parseAuthResults([gmail], authservTrust("gmail")), { spf: "pass", dkim: "pass", dmarc: "pass", dkim_domain: "news.example" });
  assert.deepEqual(parseAuthResults([microsoft], authservTrust("outlook")), { spf: "softfail", dkim: "none", dmarc: "fail" }, "Microsoft names no server");
  assert.equal(parseAuthResults([gmail], authservTrust("outlook")), null);
  assert.deepEqual(parseAuthResults(["mx.icloud.com; spf=pass"], authservTrust("icloud")), { spf: "pass" });
  assert.deepEqual(parseAuthResults(["mail.afrihost.co.za; spf=pass"], authservTrust("imap", "imap.afrihost.co.za")), { spf: "pass" });
  assert.equal(parseAuthResults(["mail.attacker.example; spf=pass"], authservTrust("imap", "imap.afrihost.co.za")), null);
  assert.equal(parseAuthResults(["spf=pass smtp.mailfrom=x"], authservTrust("imap", "imap.afrihost.co.za")), null, "no server named, nothing trusted");
});

test("the authserv-id is the first token when it is a host name", () => {
  assert.equal(authservIdOf("mx.google.com"), "mx.google.com");
  assert.equal(authservIdOf(" MX.Google.com 1 "), "mx.google.com");
  assert.equal(authservIdOf("spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=x"), null);
  assert.equal(authservIdOf("<script>"), null);
});

test("the DKIM signing domain is kept only for a signature that passed", () => {
  assert.deepEqual(parseAuthResults(["mx.example; dkim=pass header.i=@mail.news.example header.s=k1"]), { dkim: "pass", dkim_domain: "mail.news.example" });
  assert.deepEqual(parseAuthResults(["mx.example; dkim=fail header.d=news.example"]), { dkim: "fail" });
  assert.deepEqual(parseAuthResults(["mx.example; dkim=pass header.d=<b>"]), { dkim: "pass" });
});

test("organisations and DKIM alignment", () => {
  assert.equal(organisationOf("mail.acme.co.za"), "acme.co.za");
  assert.equal(organisationOf("acme.com"), "acme.com");
  assert.equal(organisationOf("a.b.acme.com"), "acme.com");
  assert.equal(organisationOf("localhost"), "localhost");
  assert.equal(dkimAligned("mail.acme.co.za", "acme.co.za"), true);
  assert.equal(dkimAligned("attacker.example", "acme.co.za"), false);
  assert.equal(dkimAligned(undefined, "acme.co.za"), false);
});

test("a From display name naming another brand is a mismatch, a plain name is not", () => {
  assert.equal(nameMismatch("PayPal.com Support", "help@evil.biz"), true);
  assert.equal(nameMismatch("billing@acme.com", "x@gmail.com"), true);
  assert.equal(nameMismatch("Acme.co.za Team", "news@mail.acme.co.za"), false);
  assert.equal(nameMismatch("St.John Smith", "john@x.com"), false);
  assert.equal(nameMismatch("Sam", "sam@gmail.com"), false);
  assert.equal(nameMismatch(null, "sam@gmail.com"), false);
  assert.equal(nameMismatch("Sam", null), false);
});
