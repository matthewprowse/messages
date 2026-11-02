// Tests for client.ts: GraphApiError keeps status, Graph code and Retry-After, only a dead sign-in counts as revoked, and a
// refresh token that cannot be saved does not fail the request or get lost.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphApiError, GraphClient, signInRevoked } from "./client";
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

test("a rotated refresh token that fails to save does not fail the request, and is saved at the next refresh", async () => {
  const realFetch = globalThis.fetch;
  let tokens = 0;
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith("/token")) {
      tokens++;
      return new Response(JSON.stringify({ access_token: `a${tokens}`, expires_in: 0, refresh_token: "new" }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const saved: string[] = [];
    let fail = true;
    const client = new GraphClient({ clientId: "c", clientSecret: "", refreshToken: "old" }, async (t) => {
      if (fail) throw new Error("db down");
      saved.push(t);
    });
    assert.deepEqual(await client.request("/me"), { ok: true });
    assert.deepEqual(saved, []);
    fail = false;
    await client.request("/me"); // expires_in 0: refreshed again, and the unsaved token goes out with it
    assert.deepEqual(saved, ["new"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
