import { test } from "node:test";
import assert from "node:assert/strict";
import { ICLOUD_IMAP, ICLOUD_SERVICE, ICLOUD_SMTP, IMAP_SERVICE, imapOptions, pinned, smtpOptions, type ImapCredentials } from "./mail-service";

test("iCloud connects exactly as it always has", async () => {
  // The settings the iCloud connector, pnpm connect:icloud and the backfill script used before the IMAP connector.
  assert.deepEqual(ICLOUD_IMAP, { host: "imap.mail.me.com", port: 993, secure: true });
  assert.deepEqual(ICLOUD_SMTP, { host: "smtp.mail.me.com", port: 587, secure: false, requireTLS: true });
  const creds = { username: "thandi@icloud.com", password: "abcd-efgh-ijkl-mnop" };
  assert.deepEqual(await ICLOUD_SERVICE.imap(creds), ICLOUD_IMAP);
  assert.deepEqual(await ICLOUD_SERVICE.smtp(creds), ICLOUD_SMTP);
  assert.equal(ICLOUD_SERVICE.rejected(creds), "iCloud rejected the app-specific password. Create a new one and reconnect.");
  assert.equal(ICLOUD_SERVICE.attachments, "icloud");
});

test("connection options never fall back to plain text", () => {
  assert.deepEqual(imapOptions({ host: "mail.firm.co.za", port: 143, tls: "starttls" }), { host: "mail.firm.co.za", port: 143, secure: false, doSTARTTLS: true });
  assert.deepEqual(smtpOptions({ host: "mail.firm.co.za", port: 465, security: "ssl" }), { host: "mail.firm.co.za", port: 465, secure: true });
});

test("a typed-in server is connected to by its public address, with its name for TLS", async () => {
  assert.deepEqual(await pinned("mail.firm.co.za", async () => "196.22.132.10"), { host: "196.22.132.10", servername: "mail.firm.co.za" });
  await assert.rejects(pinned("intranet.firm.co.za", async () => null), { code: "HOST_NOT_PUBLIC" });
});

test("a generic mailbox's messages name its host, never iCloud", () => {
  const creds: ImapCredentials = {
    username: "thandi@firm.co.za",
    password: "secret",
    imap: { host: "mail.firm.co.za", port: 993, tls: "tls" },
    smtp: { host: "mail.firm.co.za", port: 465, security: "ssl" },
  };
  const texts = [IMAP_SERVICE.rejected(creds), IMAP_SERVICE.name, IMAP_SERVICE.object, IMAP_SERVICE.trashName];
  assert.equal(texts[0], "mail.firm.co.za rejected the password. Check it, then reconnect in Settings.");
  for (const t of texts) assert.doesNotMatch(t, /icloud|apple|[–—]/i);
  assert.equal(IMAP_SERVICE.attachments, "imap");
});
