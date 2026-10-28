// Connects your iCloud+ Mail account from the terminal, so the app-specific password is typed only here,
// checked against iCloud, encrypted, and stored. It is never printed or logged.
// Run with: pnpm --filter worker connect:icloud

import { ImapFlow } from "imapflow";
import { db, must } from "../src/db";
import { credentialSealer } from "../src/vault";
import { ICLOUD_IMAP, type ICloudCredentials } from "../src/connectors/icloud";
import { ask, ownerUserId, saveAccountRow } from "./owner";

async function main() {
  console.log("\nConnect iCloud+ Mail\n");
  const ownerEmail = (await ask("Email you will sign in to the Messages app with: ")).trim().toLowerCase();
  const address = (await ask("Your custom domain address, the one people email you at: ")).trim().toLowerCase();
  const username = (await ask("Your iCloud Mail sign-in address, usually ending @icloud.com: ")).trim().toLowerCase();
  const aliasInput = await ask("Other addresses you send from, comma separated (press Enter to skip): ");
  const password = (await ask("App-specific password (hidden while you type): ", true)).replace(/\s+/g, "");

  if (!ownerEmail || !address || !username || !password) {
    console.error("\nEvery field except other addresses is required.");
    process.exit(1);
  }

  process.stdout.write("\nChecking the password with iCloud... ");
  const probe = new ImapFlow({ ...ICLOUD_IMAP, auth: { user: username, pass: password }, logger: false });
  try {
    await probe.connect();
    await probe.logout();
    console.log("signed in.");
  } catch (err) {
    console.log("failed.");
    const authFailed = (err as { authenticationFailed?: boolean }).authenticationFailed;
    console.error(
      authFailed
        ? "iCloud rejected the sign-in. Check the sign-in address, and create a new app-specific password at account.apple.com."
        : "Could not reach iCloud Mail. Check your connection and try again.",
    );
    process.exit(1);
  }

  const userId = await ownerUserId(ownerEmail);

  const account = await saveAccountRow(userId, "icloud", "iCloud+ Mail", address);

  const credentials: ICloudCredentials = {
    username,
    password,
    aliases: aliasInput.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean),
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
