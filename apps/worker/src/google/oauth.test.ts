// Tests for google/oauth.ts: the PKCE pair, the sign-in URL and its default scopes, and reading which scopes Google granted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AUTH_URL, GMAIL_SCOPE, GoogleAuthError, SCOPES, authUrl, grantedScopes, pkce } from "./oauth";

test("the PKCE challenge is the SHA-256 of the verifier, and each sign-in gets a new pair", () => {
  const a = pkce();
  assert.equal(a.challenge, createHash("sha256").update(a.verifier).digest("base64url"));
  assert.notEqual(a.verifier, pkce().verifier);
});

test("the sign-in URL asks for a refresh token with every default scope", () => {
  const url = new URL(authUrl({ clientId: "id", redirectUri: "http://localhost/cb", state: "s1", challenge: "c1" }));
  assert.equal(`${url.origin}${url.pathname}`, AUTH_URL);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "s1");
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), SCOPES);
});

test("scopes given by the caller replace the defaults", () => {
  const url = new URL(authUrl({ clientId: "id", redirectUri: "r", state: "s", challenge: "c", scopes: [GMAIL_SCOPE] }));
  assert.equal(url.searchParams.get("scope"), GMAIL_SCOPE);
});

test("granted scopes are read from Google's space-separated list", () => {
  assert.deepEqual(grantedScopes("a  b\nc"), ["a", "b", "c"]);
  assert.deepEqual(grantedScopes(undefined), []);
});

test("a token error carries Google's code", () => {
  const err = new GoogleAuthError("invalid_grant");
  assert.equal(err.code, "invalid_grant");
  assert.match(err.message, /invalid_grant/);
});
