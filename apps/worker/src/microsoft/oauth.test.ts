import assert from "node:assert/strict";
import { test } from "node:test";
import { TASKS_SCOPE, TEAMS_SCOPES, adminConsentUrl, authUrl, grantedScopes, needsAdminApproval, optionalGranted } from "./oauth";

test("reads granted scopes in either form Microsoft uses", () => {
  assert.deepEqual(
    grantedScopes("https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send openid profile email"),
    ["Mail.ReadWrite", "Mail.Send"],
  );
  assert.deepEqual(grantedScopes("mail.readwrite Calendars.Read User.Read offline_access"), ["Mail.ReadWrite", "Calendars.Read", "User.Read"]);
  assert.deepEqual(grantedScopes(undefined), []);
});

test("asks for every Graph scope, a refresh token and PKCE", () => {
  const url = new URL(authUrl({ clientId: "client", redirectUri: "http://localhost:5000", state: "s", challenge: "c" }));
  assert.equal(url.origin, "https://login.microsoftonline.com");
  assert.equal(url.pathname, "/common/oauth2/v2.0/authorize");
  const scope = url.searchParams.get("scope")!.split(" ");
  assert.ok(scope.includes("offline_access"));
  assert.ok(scope.includes("https://graph.microsoft.com/Mail.ReadWrite"));
  assert.ok(scope.includes("https://graph.microsoft.com/Calendars.Read"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:5000");
});

test("asks for To Do only when it is chosen", () => {
  const base = { clientId: "client", redirectUri: "http://localhost:5000", state: "s", challenge: "c" };
  const scopes = (url: string) => new URL(url).searchParams.get("scope")!.split(" ");
  assert.ok(!scopes(authUrl(base)).includes("https://graph.microsoft.com/Tasks.ReadWrite"));
  const withTodo = scopes(authUrl({ ...base, extraScopes: [TASKS_SCOPE] }));
  assert.ok(withTodo.includes("https://graph.microsoft.com/Tasks.ReadWrite"));
  assert.ok(withTodo.includes("https://graph.microsoft.com/Mail.ReadWrite"));
  assert.deepEqual(grantedScopes("https://graph.microsoft.com/tasks.readwrite Mail.ReadWrite"), ["Tasks.ReadWrite", "Mail.ReadWrite"]);
  assert.deepEqual(optionalGranted(["Mail.ReadWrite", "Tasks.ReadWrite"]), ["Tasks.ReadWrite"]);
  assert.deepEqual(optionalGranted(["Mail.ReadWrite"]), []);
});

test("asks for Teams only when it is chosen", () => {
  const scopes = (extra?: string[]) =>
    new URL(authUrl({ clientId: "client", redirectUri: "http://localhost:5000", state: "s", challenge: "c", extraScopes: extra })).searchParams.get("scope")!.split(" ");
  assert.ok(!scopes().includes("https://graph.microsoft.com/Chat.ReadWrite"));
  const withTeams = scopes(TEAMS_SCOPES);
  for (const s of TEAMS_SCOPES) assert.ok(withTeams.includes(`https://graph.microsoft.com/${s}`));
  assert.ok(withTeams.includes("https://graph.microsoft.com/Mail.ReadWrite"));
  assert.equal(scopes(["Mail.ReadWrite"]).length, scopes().length, "no scope twice");
});

test("reads granted Teams scopes", () => {
  assert.deepEqual(
    grantedScopes("https://graph.microsoft.com/Chat.ReadWrite https://graph.microsoft.com/OnlineMeetings.Read onlinemeetingtranscript.read.all"),
    ["Chat.ReadWrite", "OnlineMeetings.Read", "OnlineMeetingTranscript.Read.All"],
  );
});

test("knows when a sign-in needs an IT admin's approval", () => {
  assert.ok(needsAdminApproval("consent_required", null));
  assert.ok(needsAdminApproval("access_denied", "AADSTS90094: Admin consent is required for the permissions requested by this application."));
  assert.ok(needsAdminApproval("access_denied", "AADSTS65001: The user or administrator has not consented to use the application"));
  assert.ok(!needsAdminApproval("access_denied", "AADSTS65004: User declined to consent to access the app."));
  assert.ok(!needsAdminApproval(null, null));
});

test("an admin approves for an organisation, never for common", () => {
  const url = new URL(adminConsentUrl({ clientId: "client", scopes: TEAMS_SCOPES }));
  assert.equal(url.pathname, "/organizations/v2.0/adminconsent");
  assert.equal(url.searchParams.get("client_id"), "client");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost");
  assert.ok(url.searchParams.get("scope")!.split(" ").includes("https://graph.microsoft.com/OnlineMeetingTranscript.Read.All"));
});
