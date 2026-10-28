// Tests for packages/mail-servers/src/probe.ts. Pin down how IMAP and SMTP errors are classified (rejected, certificate,
// tls, unreachable), which working server is chosen, and the failure text shown to the user.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, failureText, findWorking, type CheckResult } from "./probe";
import { isPublicAddress } from "./net";
import type { Candidates, ImapServer, SmtpServer } from "./index";

// Errors as imapflow and nodemailer raise them (codes and flags only; their messages are never shown).
test("a rejected password is told apart from the rest", () => {
  assert.equal(classify({ authenticationFailed: true, code: "AUTHENTICATIONFAILED" }), "rejected");
  assert.equal(classify({ code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }), "rejected");
});

test("certificate problems, from imapflow's own code or nodemailer's original one", () => {
  assert.equal(classify({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }), "certificate");
  assert.equal(classify({ code: "ESOCKET", originalCode: "DEPTH_ZERO_SELF_SIGNED_CERT" }), "certificate");
  assert.equal(classify({ code: "ESOCKET", originalCode: "CERT_HAS_EXPIRED" }), "certificate");
});

test("a TLS mismatch: TLS to a plain port, or plain text to a TLS port", () => {
  assert.equal(classify({ code: "ESOCKET", originalCode: "ERR_SSL_WRONG_VERSION_NUMBER" }), "tls");
  assert.equal(classify({ code: "ESOCKET", message: "write EPROTO 0C:error:0A00010B:SSL routines:ssl3_get_record:wrong version number" }), "tls");
  assert.equal(classify({ code: "GREETING_TIMEOUT" }), "tls");
  assert.equal(classify({ code: "ETIMEDOUT", timeoutType: "GREETING" }), "tls");
  assert.equal(classify({ code: "ETLS", command: "STARTTLS" }), "tls");
});

test("anything else is an unreachable server", () => {
  assert.equal(classify({ code: "ENOTFOUND" }), "unreachable");
  assert.equal(classify({ code: "ECONNECTION", originalCode: "ECONNREFUSED" }), "unreachable");
  assert.equal(classify({ code: "ETIMEDOUT", timeoutType: "CONNECTION" }), "unreachable");
  assert.equal(classify({ code: "CONNECT_TIMEOUT" }), "unreachable");
  assert.equal(classify(undefined), "unreachable");
});

test("private and reserved addresses are never connected to", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["196.22.132.1", "8.8.8.8", "2c0f:f850:1:219::1", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(ip), true, ip);
});

const candidates: Candidates = {
  imap: [{ host: "mail.firm.co.za", port: 993, tls: "tls" }, { host: "imap.firm.co.za", port: 993, tls: "tls" }],
  smtp: [{ host: "mail.firm.co.za", port: 465, security: "ssl" }, { host: "mail.firm.co.za", port: 587, security: "starttls" }],
  username: "thandi@firm.co.za",
  source: "guess",
  label: "Email",
};

function fake(imap: Record<string, CheckResult>, smtp: Record<string, CheckResult>) {
  const tried: string[] = [];
  return {
    tried,
    checks: {
      imap: async (s: ImapServer) => (tried.push(`imap ${s.host}`), imap[s.host] ?? "unreachable"),
      smtp: async (s: SmtpServer) => (tried.push(`smtp ${s.host}:${s.port}`), smtp[`${s.host}:${s.port}`] ?? "unreachable"),
    },
  };
}

test("the first IMAP and SMTP servers that accept the sign-in are kept", async () => {
  const { checks, tried } = fake({ "imap.firm.co.za": "ok" }, { "mail.firm.co.za:587": "ok" });
  assert.deepEqual(await findWorking(candidates, "pw", checks), {
    settings: { imap: candidates.imap[1], smtp: candidates.smtp[1], username: "thandi@firm.co.za" },
  });
  assert.deepEqual(tried, ["imap mail.firm.co.za", "imap imap.firm.co.za", "smtp mail.firm.co.za:465", "smtp mail.firm.co.za:587"]);
});

test("a rejected password stops at once, so it is not tried on every server", async () => {
  const { checks, tried } = fake({ "mail.firm.co.za": "rejected", "imap.firm.co.za": "ok" }, {});
  const result = await findWorking(candidates, "pw", checks);
  assert.ok("failure" in result);
  assert.equal(result.failure.result, "rejected");
  assert.deepEqual(tried, ["imap mail.firm.co.za"]);
});

test("when nothing works, the most telling failure is reported", async () => {
  const { checks } = fake({ "mail.firm.co.za": "unreachable", "imap.firm.co.za": "certificate" }, {});
  const result = await findWorking(candidates, "pw", checks);
  assert.ok("failure" in result);
  assert.equal(result.failure.result, "certificate");
  assert.equal(result.failure.server.host, "imap.firm.co.za");
});

test("SMTP failures say signing in to read worked", async () => {
  const { checks } = fake({ "mail.firm.co.za": "ok" }, { "mail.firm.co.za:465": "rejected" });
  const result = await findWorking(candidates, "pw", checks);
  assert.ok("failure" in result);
  assert.equal(result.failure.side, "smtp");
  assert.match(failureText(result.failure), /^Signed in to read mail, but mail\.firm\.co\.za did not accept/);
});

test("failure text names the host and never uses dashes", () => {
  const texts = [
    failureText({ side: "imap", result: "rejected", server: candidates.imap[0] }, "Yahoo needs an app password."),
    failureText({ side: "imap", result: "unreachable", server: candidates.imap[0] }),
    failureText({ side: "imap", result: "tls", server: { host: "mail.firm.co.za", port: 993, tls: "starttls" } }),
    failureText({ side: "smtp", result: "tls", server: candidates.smtp[0] }),
    failureText({ side: "imap", result: "certificate", server: candidates.imap[0] }),
  ];
  assert.equal(texts[0], "mail.firm.co.za did not accept that email and password. Check them and try again. Yahoo needs an app password.");
  assert.equal(texts[2], "mail.firm.co.za did not answer with STARTTLS on port 993. Port 993 uses SSL and port 143 uses STARTTLS.");
  assert.equal(texts[3], "mail.firm.co.za did not answer with SSL on port 465. Port 465 uses SSL and port 587 uses STARTTLS.");
  for (const t of texts) {
    assert.match(t, /mail\.firm\.co\.za/);
    assert.doesNotMatch(t, /[–—]/);
  }
});
