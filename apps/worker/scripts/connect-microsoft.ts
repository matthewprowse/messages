import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { db, must } from "../src/db";
import { credentialSealer } from "../src/vault";
import { env } from "../src/env";
import { pkce } from "../src/google/oauth";
import { GRAPH } from "../src/microsoft/client";
import {
  CALENDAR_SCOPE,
  CHAT_SCOPE,
  MAIL_SCOPE,
  MicrosoftAuthError,
  SEND_SCOPE,
  TASKS_SCOPE,
  TEAMS_SCOPES,
  TRANSCRIPT_SCOPE,
  adminConsentUrl,
  authUrl,
  exchangeCode,
  grantedScopes,
  needsAdminApproval,
  type MicrosoftCredentials,
} from "../src/microsoft/oauth";
import { ask, ownerUserId, saveAccountRow } from "./owner";

// Connects Outlook mail and Outlook Calendar from the terminal, the way connect-google.ts does for Google,
// and Microsoft Teams and Microsoft To Do too when you choose them. Microsoft's sign-in opens in your browser
// and returns to a one-time local address on this Mac, so the refresh token never passes through the web app.
// It is encrypted before it is stored, and never printed or logged. Works for Microsoft 365 work and school
// accounts and for Outlook.com, Hotmail and Live; Teams needs a work or school account.
// Run with: pnpm connect:microsoft

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/** Microsoft turned the sign-in away until an IT admin approves the app. */
class AdminApprovalNeeded extends Error {}

const PERSONAL_TEAMS = "Microsoft would not grant the Teams permissions. Teams needs a work or school account, so for a personal account run this again and answer No to Teams.";

/** Yes or no in the terminal, with the answer used when you just press Return. */
async function yes(question: string, otherwise: boolean): Promise<boolean> {
  const answer = (await ask(`${question} ${otherwise ? "(Y/n)" : "(y/N)"} `)).trim().toLowerCase();
  return answer ? answer.startsWith("y") : otherwise;
}

/**
 * Waits for Microsoft to send the browser back to http://localhost:<port> with a code. Microsoft matches
 * a localhost redirect without its port, so the registered http://localhost covers any port.
 */
async function signIn(extraScopes: string[]): Promise<{ code: string; redirectUri: string; verifier: string }> {
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  const redirectUri = `http://localhost:${(server.address() as AddressInfo).port}`;

  const url = authUrl({ clientId: env.microsoftClientId, redirectUri, state, challenge, extraScopes });
  console.log("\nOpening Microsoft sign-in in your browser. If it does not open, paste this address into it:\n");
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
        const error = params.get("error");
        if (needsAdminApproval(error, params.get("error_description"))) reject(new AdminApprovalNeeded("admin approval needed"));
        else if (error === "invalid_scope" && extraScopes.length) reject(new Error(PERSONAL_TEAMS));
        else if (error === "access_denied") reject(new Error("You cancelled the Microsoft sign-in, or an administrator has to approve Messages first."));
        else if (!ok) reject(new Error("Microsoft's reply did not match this sign-in. Run the command again."));
        else resolve(params.get("code")!);
      });
    });
    return { code, redirectUri, verifier };
  } finally {
    server.close();
  }
}

async function saveAccount(userId: string, provider: "outlook" | "outlook_calendar" | "teams" | "microsoft_todo", label: string, address: string, credentials: MicrosoftCredentials) {
  const account = await saveAccountRow(userId, provider, label, address);
  must(
    await db
      .from("account_credentials")
      .upsert(
        // A new sign-in replaces any token the connectors kept from the last one.
        { account_id: account.id, ciphertext: await (await credentialSealer(account.id, userId)).sealJson(credentials), refreshed: null, updated_at: new Date().toISOString() },
        { onConflict: "account_id" },
      ),
    `save ${provider} credentials`,
  );
}

async function main() {
  if (!env.microsoftClientId) {
    console.error("Add MICROSOFT_CLIENT_ID to apps/worker/.env first. apps/worker/README.md shows where to get it.");
    process.exit(1);
  }

  console.log("\nConnect Outlook, Outlook Calendar, Microsoft Teams and Microsoft To Do\n");
  const ownerEmail = (await ask("Email you will sign in to the Messages app with: ")).trim().toLowerCase();
  if (!ownerEmail) {
    console.error("\nThe email is required.");
    process.exit(1);
  }
  // Teams is asked for only when chosen: an organisation that needs an admin to approve it would otherwise
  // block the Outlook sign-in too. Transcripts are the permission admins are most often asked about.
  const teams = await yes("Connect Microsoft Teams chats too? It needs a work or school account, and your IT admin may need to approve it.", false);
  const transcripts = teams && (await yes("Include Teams meeting transcripts?", true));

  // To Do is a choice too: saying yes asks Microsoft for Tasks.ReadWrite, and adds a Microsoft To Do account.
  const wantTodo = await yes("Connect Microsoft To Do as well?", false);
  const extraScopes = [...(teams ? (transcripts ? TEAMS_SCOPES : [CHAT_SCOPE]) : []), ...(wantTodo ? [TASKS_SCOPE] : [])];

  let signedIn: Awaited<ReturnType<typeof signIn>>;
  try {
    signedIn = await signIn(extraScopes);
  } catch (err) {
    if (!(err instanceof AdminApprovalNeeded)) throw err;
    adminApprovalHelp(extraScopes);
    process.exit(1);
  }
  const { code, redirectUri, verifier } = signedIn;
  process.stdout.write("Finishing sign-in with Microsoft... ");
  const tokens = await exchangeCode({ clientId: env.microsoftClientId, clientSecret: env.microsoftClientSecret, code, redirectUri, verifier, extraScopes }).catch((err) => {
    if (err instanceof MicrosoftAuthError && err.code === "consent_required") {
      console.log("failed.");
      adminApprovalHelp(extraScopes);
      process.exit(1);
    }
    throw err;
  });
  if (!tokens.refresh_token) {
    console.log("failed.");
    console.error("Microsoft did not issue a refresh token. Run this again and accept every permission.");
    process.exit(1);
  }
  const scopes = grantedScopes(tokens.scope);
  const credentials: MicrosoftCredentials = { refreshToken: tokens.refresh_token, scopes };
  console.log("done.");

  const hasMail = scopes.includes(MAIL_SCOPE);
  const hasCalendar = scopes.includes(CALENDAR_SCOPE);
  const hasTeams = scopes.includes(CHAT_SCOPE);
  const hasTodo = scopes.includes(TASKS_SCOPE);
  if (!hasMail && !hasCalendar && !hasTeams && !hasTodo) {
    console.error("\nNo access was granted. Run this again and accept every permission Microsoft asks for.");
    process.exit(1);
  }

  // Who signed in. A personal account has no "mail" field; its sign-in name is its address.
  const response = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Object.assign(new Error("profile request failed"), { code: `HTTP_${response.status}` });
  const me = (await response.json()) as { mail?: string | null; userPrincipalName?: string | null };
  const address = (me.mail || me.userPrincipalName || "").trim().toLowerCase();
  if (!address.includes("@")) {
    console.error("\nMicrosoft did not say which address this account uses.");
    process.exit(1);
  }

  const userId = await ownerUserId(ownerEmail);
  if (hasMail) await saveAccount(userId, "outlook", "Outlook", address, credentials);
  if (hasCalendar) await saveAccount(userId, "outlook_calendar", "Outlook Calendar", address, credentials);
  // Teams and To Do have their own account rows, like the calendar, so each shows and fails on its own in Settings.
  if (hasTeams) await saveAccount(userId, "teams", "Microsoft Teams", address, credentials);
  if (hasTodo) await saveAccount(userId, "microsoft_todo", "Microsoft To Do", address, credentials);

  const saved = [hasMail && "Outlook", hasCalendar && "Outlook Calendar", hasTeams && "Microsoft Teams", hasTodo && "Microsoft To Do"].filter((name): name is string => !!name);
  console.log(`\nSaved ${saved.length > 1 ? `${saved.slice(0, -1).join(", ")} and ${saved.at(-1)}` : saved[0]} for ${address}.`);
  if (!hasMail) console.log("Mail access was not granted, so Outlook is not connected. Run this again to add mail.");
  if (!hasCalendar) console.log("Calendar access was not granted, so Outlook Calendar is not connected. Run this again to add the calendar.");
  if (hasMail && !scopes.includes(SEND_SCOPE)) console.log("Sending was not granted, so replies cannot go out through Outlook. Run this again to allow it.");
  if (teams && !hasTeams) console.log("Teams access was not granted, so Teams is not connected. Your IT admin may need to approve it first.");
  if (transcripts && hasTeams && !scopes.includes(TRANSCRIPT_SCOPE)) console.log("Transcripts were not granted, so Teams meetings come in without them.");
  if (wantTodo && !hasTodo) console.log("To Do access was not granted, so Microsoft To Do is not connected. Run this again to add it.");
  console.log("Start syncing with: pnpm worker\n");
  process.exit(0);
}

/** What to do when Microsoft says an IT admin has to approve the permissions first. */
function adminApprovalHelp(extraScopes: string[]) {
  console.error("\nYour organisation needs an IT admin to approve Messages before you can connect it.");
  if (extraScopes.length) {
    console.error("Teams permissions are the ones that usually need it. Run this again and answer No to Teams to connect Outlook now.");
  }
  console.error("\nAn admin can approve it for everyone by opening this address and accepting:\n");
  console.error(adminConsentUrl({ clientId: env.microsoftClientId, scopes: extraScopes }) + "\n");
  console.error("Or in entra.microsoft.com: Enterprise Applications, Messages, Permissions, Grant Admin Consent. Then run pnpm connect:microsoft again.");
}

main().catch((err) => {
  if (err instanceof MicrosoftAuthError && (err.code === "invalid_client" || err.code === "unauthorized_client")) {
    console.error(
      "\nMicrosoft rejected the app. Check MICROSOFT_CLIENT_ID in apps/worker/.env, that the app's platform is Mobile and Desktop Applications with the redirect URI http://localhost, and which account types it allows.",
    );
  } else if (err instanceof MicrosoftAuthError && err.code === "invalid_grant") {
    console.error("\nMicrosoft did not accept the sign-in code. Run the command again.");
  } else if (err instanceof MicrosoftAuthError && err.code === "invalid_scope") {
    console.error("\n" + PERSONAL_TEAMS);
  } else if (err instanceof Error && /^(Sign-in |You cancelled|Microsoft's reply|Microsoft would not)/.test(err.message)) console.error("\n" + err.message);
  else console.error("\nSomething went wrong connecting Microsoft.", (err as { code?: string }).code ?? "");
  process.exit(1);
});
