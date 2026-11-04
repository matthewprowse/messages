// Tests for public/sw-rules.js, the service worker's caching rules: only signed-in app pages and /_next/static are
// ever answered from the cache, pages are keyed by their own path, and pruning never drops code a kept page needs.
// The file is a classic script, so it is run here the way importScripts runs it in the worker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInThisContext } from "node:vm";
import { SW_MESSAGES } from "./service-worker";

runInThisContext(readFileSync(join(__dirname, "../public/sw-rules.js"), "utf8"));

interface Rules {
  PAGE_CACHE: string;
  STATIC_CACHE: string;
  CACHE_PREFIX: string;
  MESSAGES: Record<string, string>;
  LIMITS: Record<string, number>;
  pageKey(url: URL): string | null;
  requestKind(req: { url: URL; method: string; mode: string; headers: Headers }, origin: string): "page" | "static" | null;
  isStorable(res: { status: number; type: string; redirected: boolean; headers: Headers }, kind: "page" | "static"): boolean;
  isPageFresh(storedAt: number, now: number): boolean;
  assetPaths(html: string): string[];
  buildIdOf(html: string): string | null;
  keysToPrune(entries: { key: string; storedAt: number }[], now: number, maxAgeMs: number, maxEntries: number, keep?: Set<string>): string[];
}
const R = (globalThis as unknown as { konvaSw: Rules }).konvaSw;

const ORIGIN = "https://konva.example";
const nav = (path: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) =>
  R.requestKind({ url: new URL(path, ORIGIN), method: init.method ?? "GET", mode: init.mode ?? "navigate", headers: new Headers(init.headers) }, ORIGIN);

test("navigations to every signed-in section and its subpaths are pages", () => {
  for (const path of ["/inbox", "/inbox/0b5c-1", "/summary", "/summary/abc", "/calendar?date=2026-11-03", "/contacts/team", "/notes/n1", "/attachments", "/settings", "/settings/accounts/google"]) {
    assert.equal(nav(path), "page", path);
  }
});

test("api, auth, login, marketing and other routes are never cached", () => {
  for (const path of ["/api/keys", "/api/connect/google/callback", "/login", "/auth/callback", "/", "/pricing", "/updates", "/security", "/invite/t1", "/new-email", "/admin", "/analytics", "/more", "/inboxes", "/manifest.webmanifest", "/sw.js", "/voices/a.mp3", "/icon-192.png"]) {
    assert.equal(nav(path), null, path);
  }
});

test("a sign-in callback inside a section goes to the network", () => {
  assert.equal(nav("/attachments/onedrive-callback?code=x"), null);
  assert.equal(nav("/settings/accounts/callback"), null);
});

test("RSC, prefetch, non-GET, cross-origin and non-navigation requests are not pages", () => {
  assert.equal(nav("/inbox", { headers: { rsc: "1" } }), null);
  assert.equal(nav("/inbox", { headers: { "next-router-prefetch": "1" } }), null);
  assert.equal(nav("/inbox", { headers: { purpose: "prefetch" } }), null);
  assert.equal(nav("/inbox?_rsc=abc"), null);
  assert.equal(nav("/inbox", { method: "POST" }), null);
  assert.equal(nav("/inbox", { mode: "cors" }), null);
  assert.equal(R.requestKind({ url: new URL("https://abc.supabase.co/rest/v1/threads"), method: "GET", mode: "cors", headers: new Headers() }, ORIGIN), null);
});

test("only /_next/static is cached as code, and never a range request or another origin's", () => {
  assert.equal(nav("/_next/static/chunks/app/inbox/page-1a2b.js", { mode: "no-cors" }), "static");
  assert.equal(nav("/_next/static/media/geist.woff2", { mode: "cors" }), "static");
  assert.equal(nav("/_next/image?url=x", { mode: "no-cors" }), null);
  assert.equal(nav("/_next/static/chunks/a.js", { mode: "no-cors", headers: { range: "bytes=0-1" } }), null);
  assert.equal(nav("/_next/static/chunks/a.js", { mode: "no-cors", method: "HEAD" }), null);
  assert.equal(R.requestKind({ url: new URL("https://cdn.example/_next/static/a.js"), method: "GET", mode: "no-cors", headers: new Headers() }, ORIGIN), null);
});

test("a page is keyed by its own path, without query or trailing slash, never by its section", () => {
  assert.equal(R.pageKey(new URL("/inbox/abc/?x=1", ORIGIN)), "/inbox/abc");
  assert.equal(R.pageKey(new URL("/inbox", ORIGIN)), "/inbox");
  assert.notEqual(R.pageKey(new URL("/inbox/abc", ORIGIN)), R.pageKey(new URL("/inbox/def", ORIGIN)));
});

test("only a plain 200 from this site is stored, and a page must be HTML", () => {
  const html = new Headers({ "content-type": "text/html; charset=utf-8" });
  assert.equal(R.isStorable({ status: 200, type: "basic", redirected: false, headers: html }, "page"), true);
  assert.equal(R.isStorable({ status: 200, type: "basic", redirected: false, headers: new Headers({ "content-type": "text/x-component" }) }, "page"), false);
  assert.equal(R.isStorable({ status: 200, type: "basic", redirected: true, headers: html }, "page"), false);
  assert.equal(R.isStorable({ status: 404, type: "basic", redirected: false, headers: html }, "page"), false);
  assert.equal(R.isStorable({ status: 0, type: "opaqueredirect", redirected: false, headers: html }, "page"), false);
  assert.equal(R.isStorable({ status: 200, type: "cors", redirected: false, headers: new Headers() }, "static"), false);
  assert.equal(R.isStorable({ status: 206, type: "basic", redirected: false, headers: new Headers() }, "static"), false);
});

test("a stored page is shown for three days, then the network is awaited", () => {
  const now = Date.UTC(2026, 10, 3);
  assert.equal(R.isPageFresh(now - 60_000, now), true);
  assert.equal(R.isPageFresh(now - R.LIMITS.pageMaxAgeMs - 1, now), false);
  assert.equal(R.isPageFresh(Number.NaN, now), false);
  assert.equal(R.isPageFresh(now + 60_000, now), false);
});

test("the assets of a page are found in its tags and in its RSC chunk list", () => {
  const html = `<link rel="stylesheet" href="/_next/static/css/a1.css" data-precedence="next"/><link rel="preload" href="/_next/static/media/f1.woff2" as="font"/>`
    + `<script src="/_next/static/chunks/webpack-1.js" nonce="n" async=""></script><script src="/_next/static/chunks/webpack-1.js"></script>`
    + `<script nonce="n">self.__next_f.push([1,"2:I[123,[\\"456\\",\\"static/chunks/456-ab.js\\",\\"789\\",\\"static/chunks/app/inbox/page-cd.js\\"],\\"default\\"]\\n"])</script>`;
  assert.deepEqual(R.assetPaths(html).sort(), [
    "/_next/static/chunks/456-ab.js",
    "/_next/static/chunks/app/inbox/page-cd.js",
    "/_next/static/chunks/webpack-1.js",
    "/_next/static/css/a1.css",
    "/_next/static/media/f1.woff2",
  ]);
});

test("the build id is read from the RSC payload, escaped or not", () => {
  assert.equal(R.buildIdOf(`self.__next_f.push([1,"0:{\\"P\\":null,\\"b\\":\\"Xy_12-ab\\",\\"p\\":\\"\\"}"])`), "Xy_12-ab");
  assert.equal(R.buildIdOf(`{"b":"abcd1234"}`), "abcd1234");
  assert.equal(R.buildIdOf("<html></html>"), null);
});

test("pruning drops entries past their age, then the oldest past the count, but never a kept one", () => {
  const now = 1_000_000;
  const entries = [
    { key: "old", storedAt: now - 500 },
    { key: "a", storedAt: now - 30 },
    { key: "b", storedAt: now - 20 },
    { key: "c", storedAt: now - 10 },
    { key: "needed", storedAt: now - 900 },
    { key: "broken", storedAt: Number.NaN },
  ];
  assert.deepEqual(R.keysToPrune(entries, now, 100, 2, new Set(["needed"])).sort(), ["a", "b", "broken", "old"]);
  assert.deepEqual(R.keysToPrune(entries, now, 100, 10).sort(), ["broken", "needed", "old"]);
});

test("cache names are versioned under one prefix, so activate can clear older ones", () => {
  assert.ok(R.PAGE_CACHE.startsWith(R.CACHE_PREFIX) && R.STATIC_CACHE.startsWith(R.CACHE_PREFIX));
  assert.notEqual(R.PAGE_CACHE, R.STATIC_CACHE);
});

test("the page and the worker agree on the message names", () => {
  assert.deepEqual({ ...R.MESSAGES }, { ...SW_MESSAGES });
});
