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
  assert.deepEqual(parseAuthResults([gmail]), { spf: "pass", dkim: "pass", dmarc: "pass" });
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
  assert.deepEqual(parseAuthResults(["mx.example; dkim=fail header.d=a.example; dkim=pass header.d=b.example"]), { dkim: "pass" });
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
