// Connects Gmail, Google Calendar and Google Tasks from the terminal, and Meet transcripts and Google Chat when asked. Google's sign-in opens in your browser and
// returns to a one-time local address on this Mac, so the refresh token never passes through the web
// app. It is encrypted before it is stored, and never printed or logged.
// Run with: pnpm connect:google

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { db, must } from "../src/db";
import { credentialSealer } from "../src/vault";
import { env } from "../src/env";
import { GoogleClient } from "../src/google/client";
import {
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_SCOPE,
  CHAT_MESSAGES_SCOPE,
  CONTACTS_SCOPE,
  GMAIL_SCOPE,
  GoogleAuthError,
  MEET_CHAT_SCOPES,
  MEET_SCOPE,
  SCOPES,
  TASKS_SCOPE,
  authUrl,
  exchangeCode,
  grantedScopes,
  pkce,
  type GoogleCredentials,
} from "../src/google/oauth";
import { PERSONAL_ACCOUNT, isWorkspace, type UserInfo } from "../src/google/meet";
import { ask, ownerUserId, saveAccountRow } from "./owner";

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/** Waits for Google to send the browser back to http://127.0.0.1:<port> with a code. */
async function signIn(scopes: string[]): Promise<{ code: string; redirectUri: string; verifier: string }> {
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const url = authUrl({ clientId: env.googleClientId, redirectUri, state, challenge, scopes });
  console.log("\nOpening Google sign-in in your browser. If it does not open, paste this address into it:\n");
  console.log(url + "\n");
  if (process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Sign-in timed out after 5 minutes.")), SIGN_IN_TIMEOUT_MS);
      server.on("request", (req, res) => {
        const params = new URL(req.url ?? "/", redirectUri).searchParams;
        if (!params.has("code") && !params.has("error")) {
          res.writeHead(404).end(); // e.g. the browser asking for a favicon
          return;
        }
        const ok = params.get("state") === state && params.has("code");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><title>Messages</title><body style="font-family:system-ui;padding:40px">` +
            (ok ? "Signed in. You can close this tab; the terminal finishes connecting." : "Sign-in did not finish. Go back to the terminal.") +
            `</body>`,
        );
        clearTimeout(timer);
        if (params.get("error") === "access_denied") reject(new Error("You cancelled the Google sign-in."));
        else if (!ok) reject(new Error("Google's reply did not match this sign-in. Run the command again."));
        else resolve(params.get("code")!);
      });
    });
    return { code, redirectUri, verifier };
  } finally {
    server.close();
  }
}

async function saveAccount(userId: string, provider: "gmail" | "google_calendar" | "google_tasks" | "google_meet", label: string, address: string, credentials: GoogleCredentials) {
  const account = await saveAccountRow(userId, provider, label, address);
  must(
    await db
      .from("account_credentials")
      .upsert(
        { account_id: account.id, ciphertext: await (await credentialSealer(account.id, userId)).sealJson(credentials), updated_at: new Date().toISOString() },
        { onConflict: "account_id" },
      ),
    `save ${provider} credentials`,
  );
}

async function main() {
  if (!env.googleClientId || !env.googleClientSecret) {
    console.error("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to apps/worker/.env first. apps/worker/README.md shows where to get them.");
    process.exit(1);
  }

  console.log("\nConnect Gmail, Google Calendar and Google Tasks\n");
  const ownerEmail = (await ask("Email you will sign in to the Messages app with: ")).trim().toLowerCase();
  if (!ownerEmail) {
    console.error("\nThe email is required.");
    process.exit(1);
  }

  // Meet transcripts and Google Chat need a Google Workspace account, and add scopes Google reviews, so they are asked for only when wanted.
  const meet = /^y(es)?$/i.test((await ask("Also connect Meet transcripts and Google Chat? They need a Google Workspace account. (y/N): ")).trim());
  const { code, redirectUri, verifier } = await signIn(meet ? [...SCOPES, ...MEET_CHAT_SCOPES] : SCOPES);
  process.stdout.write("Finishing sign-in with Google... ");
  const tokens = await exchangeCode({ clientId: env.googleClientId, clientSecret: env.googleClientSecret, code, redirectUri, verifier });
  if (!tokens.refresh_token) {
    console.log("failed.");
    console.error("Google did not issue a refresh token. Remove Messages at myaccount.google.com/connections, then run this again.");
    process.exit(1);
  }
  const scopes = grantedScopes(tokens.scope);
  const credentials: GoogleCredentials = { refreshToken: tokens.refresh_token, scopes };
  const client = new GoogleClient({ clientId: env.googleClientId, clientSecret: env.googleClientSecret, refreshToken: tokens.refresh_token });
  console.log("done.");

  const hasGmail = scopes.includes(GMAIL_SCOPE);
  const hasCalendar = scopes.includes(CALENDAR_SCOPE);
  let hasMeet = scopes.includes(MEET_SCOPE) || scopes.includes(CHAT_MESSAGES_SCOPE);
  if (!hasGmail && !hasCalendar && !hasMeet) {
    console.error("\nNo access was granted. Run this again and leave the boxes ticked on Google's consent screen.");
    process.exit(1);
  }
  const info = hasMeet ? await client.request<UserInfo>("https://openidconnect.googleapis.com/v1/userinfo").catch(() => null) : null;

  const userId = await ownerUserId(ownerEmail);
  let address: string;
  if (hasGmail) {
    const profile = await client.request<{ emailAddress: string }>("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    address = profile.emailAddress.toLowerCase();
    await saveAccount(userId, "gmail", "Gmail", address, credentials);
  } else if (hasCalendar) {
    const primary = await client.request<{ id: string }>("https://www.googleapis.com/calendar/v3/calendars/primary");
    address = primary.id.toLowerCase();
  } else if (info?.email) {
    address = info.email.toLowerCase();
  } else {
    console.error("\nGoogle did not say which account signed in. Run this again and leave every box ticked.");
    process.exit(1);
  }
  if (hasCalendar) await saveAccount(userId, "google_calendar", "Google Calendar", address, credentials);
  // Google Tasks gives no address of its own, so it is connected alongside Gmail, Calendar or Meet.
  const hasTasks = scopes.includes(TASKS_SCOPE);
  if (hasTasks) await saveAccount(userId, "google_tasks", "Google Tasks", address, credentials);
  if (hasMeet && !isWorkspace(info, address)) {
    console.log(`\n${PERSONAL_ACCOUNT}`);
    hasMeet = false;
  }
  if (hasMeet) await saveAccount(userId, "google_meet", "Google Meet and Chat", address, credentials);

  const saved = [hasGmail && "Gmail", hasCalendar && "Google Calendar", hasTasks && "Google Tasks", hasMeet && "Google Meet and Chat"].filter((name): name is string => !!name);
  if (saved.length === 0) process.exit(1);
  console.log(`\nSaved ${saved.length > 1 ? `${saved.slice(0, -1).join(", ")} and ${saved.at(-1)}` : saved[0]} for ${address}.`);
  if (!hasGmail) console.log("Gmail access was not granted. Run this again to add Gmail.");
  if (!hasCalendar) console.log("Calendar access was not granted. Run this again to add Calendar.");
  if (hasMeet && !scopes.includes(MEET_SCOPE)) console.log("Meet access was not granted, so only Google Chat is connected. Run this again to add Meet transcripts.");
  if (hasMeet && !scopes.includes(CHAT_MESSAGES_SCOPE)) console.log("Chat access was not granted, so only Meet transcripts are connected. Run this again to add Google Chat.");
  if (hasCalendar && !scopes.includes(CALENDAR_EVENTS_SCOPE)) {
    console.log("Access to create events was not granted, so events made in Messages cannot be added to Google Calendar. Run this again to add it.");
  }
  if (!hasTasks) console.log("Tasks access was not granted, so Google Tasks is not connected. Run this again to add it.");
  if (!scopes.includes(CONTACTS_SCOPE)) console.log("Contacts access was not granted, so contact photos and names come from iCloud and WhatsApp only.");
  console.log("Start syncing with: pnpm worker\n");
  process.exit(0);
}

main().catch((err) => {
  if (err instanceof GoogleAuthError && (err.code === "invalid_client" || err.code === "unauthorized_client")) {
    console.error("\nGoogle rejected the client. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in apps/worker/.env, and that the client type is Desktop app.");
  } else if (err instanceof GoogleAuthError && err.code === "invalid_grant") {
    console.error("\nGoogle did not accept the sign-in code. Run the command again.");
  } else if (err instanceof Error && /^(Sign-in |You cancelled|Google's reply)/.test(err.message)) console.error("\n" + err.message);
  else console.error("\nSomething went wrong connecting Google.", (err as { code?: string }).code ?? "");
  process.exit(1);
});
