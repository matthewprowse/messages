// Tests for server/microsoft.ts and the Microsoft connect route helpers: sign-in URL scopes, PKCE, granted scopes mapped to
// accounts, and spotting admin-approval cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_SCOPES, TEAMS_SCOPES, accountsFor, adminConsentUrl, authUrl, grantedScopes, needsAdminApproval, pkce } from "./microsoft";
import { MICROSOFT_COOKIE, isAdminLink, readCookie, signInProblem, type MicrosoftSignIn } from "../../app/api/connect/microsoft/shared";

const scopesOf = (url: string) => new URL(url).searchParams.get("scope")!.split(" ");
const opts = { redirectUri: "http://localhost:3000/api/connect/microsoft/callback", state: "s1", challenge: "c1", clientId: "client-1" };

test("authUrl asks for the base set, with To Do and offline_access, and no Teams scopes by default", () => {
  const url = new URL(authUrl(opts));
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(url.searchParams.get("redirect_uri"), opts.redirectUri);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "s1");
  assert.ok(!url.searchParams.has("client_secret") && !url.searchParams.has("code_verifier"));
  const scopes = scopesOf(url.toString());
  for (const s of BASE_SCOPES) assert.ok(scopes.includes(`https://graph.microsoft.com/${s}`), s);
  assert.ok(scopes.includes("offline_access"));
  for (const s of TEAMS_SCOPES) assert.ok(!scopes.some((x) => x.endsWith(s)), s);
});

test("authUrl adds the three Teams scopes when ticked", () => {
  const scopes = scopesOf(authUrl({ ...opts, teams: true }));
  for (const s of TEAMS_SCOPES) assert.ok(scopes.includes(`https://graph.microsoft.com/${s}`), s);
});

test("Calendars.ReadWrite is asked for only on its own, and it brings Calendars.Read when Microsoft lists only the broader one", () => {
  assert.ok(!scopesOf(authUrl(opts)).some((x) => x.endsWith("Calendars.ReadWrite")));
  assert.ok(scopesOf(authUrl({ ...opts, calendarWrite: true })).includes("https://graph.microsoft.com/Calendars.ReadWrite"));
  assert.ok(scopesOf(adminConsentUrl({ teams: false, calendarWrite: true, clientId: "client-1" })).includes("https://graph.microsoft.com/Calendars.ReadWrite"));
  assert.deepEqual(grantedScopes("https://graph.microsoft.com/Calendars.ReadWrite openid"), ["Calendars.ReadWrite", "Calendars.Read"]);
  assert.deepEqual(accountsFor(["Calendars.ReadWrite"]).map((r) => r.provider), ["outlook_calendar"]);
});

test("pkce challenge is a SHA-256 digest, not the verifier", () => {
  const { verifier, challenge } = pkce();
  assert.notEqual(verifier, challenge);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
});

test("grantedScopes reads long and short names in any case and drops the rest", () => {
  assert.deepEqual(
    grantedScopes("https://graph.microsoft.com/Mail.ReadWrite mail.send Calendars.Read openid profile https://graph.microsoft.com/Tasks.ReadWrite"),
    ["Mail.ReadWrite", "Mail.Send", "Calendars.Read", "Tasks.ReadWrite"],
  );
  assert.deepEqual(grantedScopes(undefined), []);
});

test("accountsFor maps granted scopes to the account rows to create", () => {
  assert.deepEqual(accountsFor(BASE_SCOPES).map((r) => r.provider), ["outlook", "outlook_calendar", "microsoft_todo"]);
  assert.deepEqual(accountsFor([...BASE_SCOPES, ...TEAMS_SCOPES]).map((r) => r.provider), ["outlook", "outlook_calendar", "microsoft_todo", "teams"]);
  assert.deepEqual(accountsFor(["Calendars.Read"]).map((r) => r.provider), ["outlook_calendar"]);
  assert.deepEqual(accountsFor(["User.Read"]), []);
  assert.equal(accountsFor(["Chat.ReadWrite"])[0].label, "Microsoft Teams");
});

test("needsAdminApproval recognises the admin consent cases", () => {
  assert.ok(needsAdminApproval("consent_required", null));
  assert.ok(needsAdminApproval("access_denied", "AADSTS90094: admin consent required"));
  assert.ok(needsAdminApproval(null, "AADSTS65001: not consented"));
  assert.ok(!needsAdminApproval("access_denied", "The user cancelled"));
  assert.ok(!needsAdminApproval(null, null));
});

test("adminConsentUrl targets organizations by default and lists the Teams scopes when asked", () => {
  const url = new URL(adminConsentUrl({ teams: true, clientId: "client-1" }));
  assert.equal(url.origin + url.pathname, "https://login.microsoftonline.com/organizations/v2.0/adminconsent");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost");
  assert.ok(url.searchParams.get("scope")!.includes("OnlineMeetingTranscript.Read.All"));
  assert.ok(!new URL(adminConsentUrl({ teams: false, clientId: "client-1" })).searchParams.get("scope")!.includes("Chat.ReadWrite"));
  assert.ok(isAdminLink(url.toString(), "client-1"));
  assert.ok(!isAdminLink("https://evil.example/https://login.microsoftonline.com/"));
  assert.ok(!isAdminLink(null));
});

test("isAdminLink takes only our own admin consent address, never another app's or another page on the host", () => {
  const ours = adminConsentUrl({ teams: false, clientId: "client-1" });
  // Made before the checks below, which narrow `ours` by its type guard.
  const lookalike = ours.replace("https://login.microsoftonline.com", "https://login.microsoftonline.com.evil.example");
  const plainHttp = ours.replace("https:", "http:");
  assert.ok(isAdminLink(ours));
  assert.ok(!isAdminLink(ours, "client-2"));
  const swap = (edit: (u: URL) => void) => { const u = new URL(ours); edit(u); return u.toString(); };
  assert.ok(!isAdminLink(swap((u) => u.searchParams.set("client_id", "attacker")), "client-1"));
  assert.ok(!isAdminLink(swap((u) => u.searchParams.set("redirect_uri", "https://evil.example")), "client-1"));
  assert.ok(!isAdminLink(swap((u) => { u.pathname = "/common/oauth2/v2.0/authorize"; }), "client-1"));
  assert.ok(!isAdminLink(swap((u) => { u.pathname = "/organizations/v2.0/adminconsent/../x"; }), "client-1"));
  assert.ok(!isAdminLink(swap((u) => { u.username = "a"; }), "client-1"));
  assert.ok(!isAdminLink(swap((u) => { u.hash = "x"; }), "client-1"));
  assert.ok(!isAdminLink(lookalike, "client-1"));
  assert.ok(!isAdminLink(plainHttp, "client-1"));
  assert.ok(!isAdminLink("not a url"));
});

const signIn: MicrosoftSignIn = { userId: "u1", state: "abc", verifier: "v", back: "/summary", teams: false, expires: 2_000 };

test("signInProblem accepts only the matching, unexpired sign-in with a code", () => {
  assert.equal(signInProblem(signIn, new URLSearchParams("state=abc&code=x"), 1_000), null);
  assert.equal(signInProblem(signIn, new URLSearchParams("state=abc&code=x"), 3_000), "expired");
  assert.equal(signInProblem(signIn, new URLSearchParams("state=zzz&code=x"), 1_000), "expired");
  assert.equal(signInProblem(signIn, new URLSearchParams("state=abc"), 1_000), "expired");
  assert.equal(signInProblem(null, new URLSearchParams("state=abc&code=x"), 1_000), "expired");
  assert.equal(signInProblem({ ...signIn, state: "" }, new URLSearchParams("code=x"), 1_000), "expired");
});

test("readCookie finds the sign-in cookie among others", () => {
  assert.equal(readCookie(`a=1; ${MICROSOFT_COOKIE}=v1:abc==; b=2`, MICROSOFT_COOKIE), "v1:abc==");
  assert.equal(readCookie("a=1", MICROSOFT_COOKIE), undefined);
  assert.equal(readCookie(null, MICROSOFT_COOKIE), undefined);
});
