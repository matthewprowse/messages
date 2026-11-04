// Tests for lib/signup-refusal.ts: a sign-up the database refused is told apart from other Auth errors, from a direct
// call and from the address Google sign-in returns to.

import test from "node:test";
import assert from "node:assert/strict";
import { authErrorInUrl, isRefusedSignup } from "./signup-refusal";

test("the database refusing a new user is a refused sign-up, other errors are not", () => {
  assert.equal(isRefusedSignup("Database error saving new user"), true);
  assert.equal(isRefusedSignup("This email is not on the approved list yet"), true);
  assert.equal(isRefusedSignup("Email rate limit exceeded"), false);
  assert.equal(isRefusedSignup(undefined), false);
});

test("the error after Google sign-in is read from the query or the fragment", () => {
  assert.equal(authErrorInUrl("?error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user", ""), "Database error saving new user");
  assert.equal(authErrorInUrl("", "#error=access_denied&error_description=Database%20error%20saving%20new%20user"), "Database error saving new user");
  assert.equal(authErrorInUrl("?error=access_denied", ""), "access_denied");
  assert.equal(authErrorInUrl("?code=abc", "#access_token=x"), null);
});
