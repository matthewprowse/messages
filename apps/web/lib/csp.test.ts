// Tests for csp.ts: the Content-Security-Policy needs a nonce for scripts and never allows unsafe-inline, with dev-only
// relaxations kept out of production.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCsp, isDocumentPath, makeNonce, STATIC_PATHS } from "./csp";

test("scripts need the nonce and never allow unsafe-inline", () => {
  const csp = buildCsp("abc123", false, "https://proj.supabase.co");
  const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
  assert.match(script, /'nonce-abc123'/);
  assert.match(script, /'strict-dynamic'/);
  assert.doesNotMatch(script, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /connect-src 'self' https:\/\/proj\.supabase\.co https:\/\/www\.googleapis\.com https:\/\/graph\.microsoft\.com https:\/\/login\.microsoftonline\.com wss:\/\/proj\.supabase\.co(;|$)/);
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

test("the cloud pickers get named hosts only, in connect-src and frame-src", () => {
  const csp = buildCsp("n", false, "https://proj.supabase.co");
  assert.match(csp, /frame-src 'self' https:\/\/docs\.google\.com /);
  assert.match(csp, /connect-src [^;]*https:\/\/graph\.microsoft\.com/);
});

test("the policy covers every document, including a dynamic page whose segment ends like a file", () => {
  for (const path of ["inbox/anything.pdf", "contacts/x.png", "inbox", "settings/accounts", "login"]) assert.equal(isDocumentPath(path), true, path);
  for (const path of ["api/keys", "_next/static/chunks/x.js", "sw.js", "favicon.ico", "logos/acme.png", "manifest.webmanifest"]) assert.equal(isDocumentPath(path), false, path);
});

test("the middleware matcher names the same paths as STATIC_PATHS, by path and never by file ending", () => {
  const source = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  const literal = /source: "([^"]+)"/.exec(source)?.[1].replace(/\\\\/g, "\\");
  assert.ok(literal, "the matcher source string");
  const matcher = new RegExp(`^${literal}$`);
  assert.doesNotMatch(literal, /\.\*\\\.\(/, "no extension rule");
  for (const p of STATIC_PATHS) assert.doesNotMatch(`/${p}${p.endsWith("/") ? "x" : ""}`, matcher, p);
  for (const path of ["/inbox/anything.pdf", "/contacts/x.png", "/inbox", "/"]) assert.match(path, matcher, path);
});
