import { discover, domainOf, fromSettings, isEmail, readSettings, type Candidates } from "@messages/mail-servers";
import { nodeLookups } from "@messages/mail-servers/net";
import { failureText, findWorking } from "@messages/mail-servers/probe";
import { db, must } from "../src/db";
import { credentialSealer } from "../src/vault";
import type { ImapCredentials } from "../src/connectors/mail-service";
import { ask, ownerUserId, saveAccountRow } from "./owner";

// Connects any IMAP and SMTP mailbox from the terminal: mail on your own domain at Afrihost, xneelo,
// Domains.co.za or any cPanel host, or Yahoo, Fastmail, Zoho and GMX. The servers are worked out from the
// address (or typed in), the sign-in is checked with both, and everything is stored encrypted. The password
// is never printed or logged, and nothing is sent.
// Run with: pnpm connect:imap

const ELSEWHERE = { google: "pnpm connect:google", microsoft: "pnpm connect:microsoft", icloud: "pnpm connect:icloud" } as const;

async function typedSettings(email: string): Promise<Candidates> {
  const domain = domainOf(email);
  const imapHost = (await ask(`IMAP server (Enter for mail.${domain}): `)).trim() || `mail.${domain}`;
  const imapPort = Number((await ask("IMAP port, 993 for SSL or 143 for STARTTLS (Enter for 993): ")).trim() || 993);
  const smtpHost = (await ask(`SMTP server (Enter for ${imapHost}): `)).trim() || imapHost;
  const smtpPort = Number((await ask("SMTP port, 465 for SSL or 587 for STARTTLS (Enter for 465): ")).trim() || 465);
  const username = (await ask(`Username (Enter for ${email}): `)).trim() || email;
  const settings = readSettings({
    imap: { host: imapHost, port: imapPort, tls: imapPort === 143 ? "starttls" : "tls" },
    smtp: { host: smtpHost, port: smtpPort, security: smtpPort === 465 ? "ssl" : "starttls" },
    username,
  });
  if ("error" in settings) {
    console.error(`\n${settings.error}`);
    process.exit(1);
  }
  return fromSettings(settings);
}

async function main() {
  console.log("\nConnect an Email Account (IMAP and SMTP)\n");
  const ownerEmail = (await ask("Email you will sign in to the Messages app with: ")).trim().toLowerCase();
  const email = (await ask("The email address to connect: ")).trim().toLowerCase();
  if (!isEmail(email)) {
    console.error("\nThat is not an email address.");
    process.exit(1);
  }
  const manual = /^y/i.test((await ask("Type the server settings yourself? (y/N): ")).trim());

  let candidates: Candidates;
  if (manual) {
    candidates = await typedSettings(email);
  } else {
    process.stdout.write("\nLooking up the mail servers... ");
    const found = await discover(email, nodeLookups());
    if ("elsewhere" in found) {
      console.log("done.");
      console.error(`This address has its own setup. Connect it with: ${ELSEWHERE[found.elsewhere]}`);
      process.exit(1);
    }
    candidates = found;
    console.log(`found ${candidates.imap[0].host} (${candidates.source}).`);
    if (candidates.hint) console.log(candidates.hint);
  }

  const aliasInput = await ask("Other addresses you send from, comma separated (press Enter to skip): ");
  const password = await ask("Password (hidden while you type): ", true);
  if (!ownerEmail || !password) {
    console.error("\nEvery field except other addresses is required.");
    process.exit(1);
  }

  process.stdout.write("\nSigning in to read and to send (nothing is sent)... ");
  const result = await findWorking(candidates, password);
  if ("failure" in result) {
    console.log("failed.");
    console.error(failureText(result.failure, candidates.hint));
    process.exit(1);
  }
  const { settings } = result;
  console.log(`signed in to ${settings.imap.host} and ${settings.smtp.host}.`);

  const userId = await ownerUserId(ownerEmail);
  const account = await saveAccountRow(userId, "imap", candidates.label, email);
  const credentials: ImapCredentials = {
    username: settings.username,
    password,
    aliases: aliasInput.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean),
    imap: settings.imap,
    smtp: settings.smtp,
  };
  must(
    await db
      .from("account_credentials")
      .upsert({ account_id: account.id, ciphertext: await (await credentialSealer(account.id, userId)).sealJson(credentials), updated_at: new Date().toISOString() }, { onConflict: "account_id" }),
    "save credentials",
  );

  console.log("\nSaved. Your password is stored encrypted.");
  console.log("Start syncing with: pnpm --filter worker dev\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Something went wrong saving the account.", (err as { code?: string }).code ?? "");
  process.exit(1);
});
