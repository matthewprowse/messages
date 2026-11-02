// Tests for csp.ts: the Content-Security-Policy needs a nonce for scripts and never allows unsafe-inline, with dev-only
// relaxations kept out of production.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsp, makeNonce } from "./csp";

test("scripts need the nonce and never allow unsafe-inline", () => {
  const csp = buildCsp("abc123", false, "https://proj.supabase.co");
  const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
  assert.match(script, /'nonce-abc123'/);
  assert.match(script, /'strict-dynamic'/);
  assert.doesNotMatch(script, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /connect-src 'self' https:\/\/proj\.supabase\.co wss:\/\/proj\.supabase\.co(;|$)/);
});

test("unsafe-eval and localhost sockets are for dev only", () => {
  assert.match(buildCsp("n", true, undefined), /script-src [^;]*'unsafe-eval'/);
  assert.match(buildCsp("n", true, undefined), /ws:\/\/localhost:\*/);
  assert.doesNotMatch(buildCsp("n", false, undefined), /unsafe-eval|localhost/);
});

test("nonces are fresh and base64", () => {
  const a = makeNonce();
  assert.notEqual(a, makeNonce());
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
});

test("img-src is https only: no http, no wildcards, no other schemes than data and blob", () => {
  const img = buildCsp("n", false, "https://proj.supabase.co").split("; ").find((d) => d.startsWith("img-src"))!;
  assert.equal(img, "img-src 'self' data: blob: https:");
  assert.doesNotMatch(img, /\shttp:|\*|unsafe/);
});

test("every fetch directive other than img-src stays narrow", () => {
  const csp = buildCsp("n", false, "https://proj.supabase.co");
  for (const d of ["default-src", "connect-src", "media-src", "font-src", "frame-src", "object-src"]) {
    const line = csp.split("; ").find((x) => x.startsWith(d))!;
    assert.doesNotMatch(line, /\shttps:(\s|$)|\*/, d);
  }
  assert.match(csp, /frame-ancestors 'none'/);
});
