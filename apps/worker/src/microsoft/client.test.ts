// Tests for client.ts: GraphApiError keeps status, Graph code and Retry-After, and only a dead sign-in counts as revoked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphApiError, signInRevoked } from "./client";
import { MicrosoftAuthError } from "./oauth";

test("a Graph error keeps the status, Graph's own code and Retry-After", () => {
  const err = new GraphApiError(429, "TooManyRequests", "12");
  assert.equal(err.status, 429);
  assert.equal(err.code, "HTTP_429");
  assert.equal(err.graphCode, "TooManyRequests");
  assert.equal(err.retryAfter, "12");
});

test("only a dead sign-in counts as revoked", () => {
  assert.equal(signInRevoked(new MicrosoftAuthError("invalid_grant")), true);
  assert.equal(signInRevoked(new MicrosoftAuthError("consent_required")), true);
  assert.equal(signInRevoked(new MicrosoftAuthError("temporarily_unavailable")), false);
  assert.equal(signInRevoked(new GraphApiError(500, null)), false);
  assert.equal(signInRevoked(new Error("network")), false);
});
