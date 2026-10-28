// Connects your iCloud Calendar from the terminal, so the app-specific password is typed only here,
// checked against iCloud, encrypted, and stored. It is never printed or logged. If iCloud+ Mail is already
// connected, its sign-in can be reused, so nothing is typed.
// Run with: pnpm --filter worker connect:icloud-calendar

import { db, loadCredentials, must } from "../src/db";
import { credentialSealer } from "../src/vault";
import type { ICloudCredentials } from "../src/connectors/icloud";
import { basicAuth, calendarHome, listCalendars } from "../src/caldav/client";
import { ask, ownerUserId, saveAccountRow } from "./owner";

/** The sign-in of the user's iCloud Mail account, when they have one. */
async function mailSignIn(userId: string): Promise<ICloudCredentials | null> {
  const mail = must(await db.from("accounts").select("id").eq("user_id", userId).eq("provider", "icloud").limit(1), "load iCloud Mail account")[0];
  return mail ? loadCredentials<ICloudCredentials>(mail.id).catch(() => null) : null;
}

async function main() {
  console.log("\nConnect iCloud Calendar\n");
  const ownerEmail = (await ask("Email you will sign in to the Messages app with: ")).trim().toLowerCase();
  if (!ownerEmail) {
    console.error("\nThe email is required.");
    process.exit(1);
  }
  const userId = await ownerUserId(ownerEmail);

  let username = "";
  let password = "";
  const existing = await mailSignIn(userId);
  if (existing) {
    const reuse = (await ask(`Use the iCloud sign-in saved for iCloud+ Mail (${existing.username})? [Y/n]: `)).trim().toLowerCase();
    if (reuse !== "n" && reuse !== "no") ({ username, password } = existing);
  }
  if (!username) {
    username = (await ask("Your Apple ID, the address you sign in to iCloud with: ")).trim().toLowerCase();
    password = (await ask("App-specific password (hidden while you type): ", true)).replace(/\s+/g, "");
  }
  if (!username || !password) {
    console.error("\nBoth the Apple ID and the app-specific password are required.");
    process.exit(1);
  }

  process.stdout.write("\nChecking the sign-in with iCloud Calendar... ");
  let calendars = 0;
  try {
    const auth = basicAuth(username, password);
    calendars = (await listCalendars(auth, await calendarHome(auth))).length;
    console.log(`signed in, ${calendars} ${calendars === 1 ? "calendar" : "calendars"} found.`);
  } catch (err) {
    console.log("failed.");
    console.error(
      (err as { code?: string }).code === "HTTP_401"
        ? "iCloud rejected the sign-in. Check the Apple ID, and create a new app-specific password at account.apple.com."
        : "Could not reach iCloud Calendar. Check your connection and try again.",
    );
    process.exit(1);
  }

  const account = await saveAccountRow(userId, "icloud_calendar", "iCloud Calendar", username, { onePerUser: true });
  const credentials: ICloudCredentials = { username, password };
  must(
    await db
      .from("account_credentials")
      .upsert({ account_id: account.id, ciphertext: await (await credentialSealer(account.id, userId)).sealJson(credentials), updated_at: new Date().toISOString() }, { onConflict: "account_id" }),
    "save credentials",
  );

  console.log("\nSaved. Your password is stored encrypted.");
  console.log("Start syncing with: pnpm worker\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Something went wrong saving the account.", (err as { code?: string }).code ?? "");
  process.exit(1);
});
