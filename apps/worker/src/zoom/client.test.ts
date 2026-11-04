// The Zoom client against a stand-in for fetch: token refresh and rotation, 429 back-off and file downloads (the token
// only to Zoom, hops off Zoom through the vetted getter, and a byte cap on every body).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { PinnedResponse } from "@messages/mail-servers/net";
import { ZoomApiError, ZoomClient, isZoomHost, meetingUuidPath, retryAfterMs, signInRevoked, type OutsideGet } from "./client";
import { TOKEN_URL, ZoomAuthError, apiBase, authUrl, grantedScopes } from "./oauth";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: string; auth: string | null; method: string; redirect?: string };

function fakeFetch(handler: (url: URL, call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const auth = new Headers(init?.headers).get("authorization");
    const call = { url: url.toString(), auth, method: init?.method ?? "GET", redirect: init?.redirect };
    calls.push(call);
    return handler(url, call);
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const token = (n: number) => json({ access_token: `at-${n}`, expires_in: 3600, refresh_token: `rt-${n}`, scope: "user:read:user", api_url: "https://api.zoom.us" });

test("refreshes with Basic auth, keeps the new refresh token, and calls the API with the access token", async () => {
  let refreshes = 0;
  const calls = fakeFetch((url) => (url.toString() === TOKEN_URL ? token(++refreshes) : json({ id: "me", email: "thandi@konva.co.za" })));
  const rotated: string[] = [];
  const client = new ZoomClient({ clientId: "cid", clientSecret: "secret", refreshToken: "rt-0" }, async (t) => void rotated.push(t));
  const [a, b] = await Promise.all([client.request<{ id: string }>("/users/me"), client.request<{ id: string }>("/users/me")]);
  assert.equal(a.id, "me");
  assert.equal(b.id, "me");
  assert.equal(refreshes, 1); // one refresh shared by both
  assert.deepEqual(rotated, ["rt-1"]);
  assert.equal(calls[0].auth, `Basic ${Buffer.from("cid:secret").toString("base64")}`);
  assert.equal(calls[1].url, "https://api.zoom.us/v2/users/me");
  assert.equal(calls[1].auth, "Bearer at-1");
});

test("waits out a 429 and tries again, then gives up with Zoom's wait", async () => {
  let tries = 0;
  fakeFetch((url) => {
    if (url.toString() === TOKEN_URL) return token(1);
    tries++;
    return tries === 1 ? json({ code: 429, message: "Too many requests" }, 429, { "retry-after": "0" }) : json({ sessions: [] });
  });
  const client = new ZoomClient({ clientId: "c", clientSecret: "s", refreshToken: "r" });
  assert.deepEqual(await client.request("/chat/users/me/sessions"), { sessions: [] });
  assert.equal(tries, 2);

  tries = 0;
  fakeFetch((url) => (url.toString() === TOKEN_URL ? token(2) : (tries++, json({ code: 429 }, 429, { "retry-after": "0" }))));
  await assert.rejects(client.request("/chat/users/me/sessions"), (err: unknown) => err instanceof ZoomApiError && err.status === 429 && err.retryAfterMs === 0);
  assert.equal(tries, 4); // the first try and three retries
});

test("refreshes once when Zoom turns the access token down", async () => {
  let refreshes = 0;
  let calls = 0;
  fakeFetch((url) => {
    if (url.toString() === TOKEN_URL) return token(++refreshes);
    calls++;
    return calls === 1 ? json({ code: 124, message: "Invalid access token." }, 401) : json({ ok: true });
  });
  const client = new ZoomClient({ clientId: "c", clientSecret: "s", refreshToken: "r" });
  assert.deepEqual(await client.request("/users/me"), { ok: true });
  assert.equal(refreshes, 2);
});

test("fails a POST on a server error without trying it again", async () => {
  let posts = 0;
  fakeFetch((url) => (url.toString() === TOKEN_URL ? token(1) : (posts++, json({}, 502))));
  const client = new ZoomClient({ clientId: "c", clientSecret: "s", refreshToken: "r" });
  await assert.rejects(client.request("/chat/users/me/messages", { method: "POST", body: { message: "x" } }), (err: unknown) => err instanceof ZoomApiError && err.status === 502);
  assert.equal(posts, 1);
});

/** A stand-in for pinnedGet: answers each URL from a table, and records what was asked. */
function fakeOutside(replies: Record<string, { status: number; body?: string; headers?: Record<string, string> }>): { get: OutsideGet; asked: string[] } {
  const asked: string[] = [];
  const get: OutsideGet = async (url) => {
    asked.push(url.toString());
    const r = replies[url.toString()];
    if (!r) throw new Error("not a public address");
    const chunks = [Buffer.from(r.body ?? "")];
    const res: PinnedResponse = { status: r.status, headers: r.headers ?? {}, body: (async function* () { yield* chunks; })(), destroy: () => undefined };
    return res;
  };
  return { get, asked };
}

const CDN = "https://ssrweb.zoom-cdn.example.net/file.vtt?sig=1";

test("downloads a recording through its redirect, sending the token only to Zoom", async () => {
  const calls = fakeFetch((url) => {
    if (url.toString() === TOKEN_URL) return token(1);
    if (url.hostname === "zoom.us") return new Response(null, { status: 302, headers: { location: CDN } });
    return new Response("not expected", { status: 500 });
  });
  const outside = fakeOutside({ [CDN]: { status: 200, body: "WEBVTT\n" } });
  const client = new ZoomClient({ clientId: "c", clientSecret: "s", refreshToken: "r" }, undefined, outside.get);
  const bytes = await client.download("https://zoom.us/rec/download/abc");
  assert.equal(bytes.toString(), "WEBVTT\n");
  const [, first] = calls;
  assert.equal(first.auth, "Bearer at-1");
  assert.equal(first.redirect, "manual");
  assert.equal(calls.length, 2, "the hop off Zoom never goes through fetch, so it cannot carry the token");
  assert.deepEqual(outside.asked, [CDN]);
});

test("a download larger than its cap is refused, on Zoom or off it", async () => {
  fakeFetch((url) => {
    if (url.toString() === TOKEN_URL) return token(1);
    if (url.pathname.endsWith("/big")) return new Response("x".repeat(100));
    return new Response(null, { status: 302, headers: { location: CDN } });
  });
  const outside = fakeOutside({ [CDN]: { status: 200, body: "y".repeat(100) } });
  const client = new ZoomClient({ clientId: "c", clientSecret: "s", refreshToken: "r" }, undefined, outside.get);
  await assert.rejects(client.download("https://zoom.us/rec/download/big", 10), (err: unknown) => err instanceof ZoomApiError && err.status === 413);
  await assert.rejects(client.download("https://zoom.us/rec/download/cdn", 10), (err: unknown) => err instanceof ZoomApiError && err.status === 413);
  assert.equal((await client.download("https://zoom.us/rec/download/cdn", 100)).length, 100);
});

test("a redirect to a private or unreachable host fails the download", async () => {
  fakeFetch((url) => (url.toString() === TOKEN_URL ? token(1) : new Response(null, { status: 302, headers: { location: "https://internal.example/x" } })));
  const client = new ZoomClient({ clientId: "c", clientSecret: "s", refreshToken: "r" }, undefined, fakeOutside({}).get);
  await assert.rejects(client.download("https://zoom.us/rec/download/abc"), (err: unknown) => err instanceof ZoomApiError && err.status === 502);
  assert.ok(isZoomHost("us02web.zoom.us") && isZoomHost("zoom.us"));
  assert.ok(!isZoomHost("zoom.us.evil.com") && !isZoomHost("notzoom.us"));
});

test("signs in with PKCE and reads what was granted", () => {
  const url = new URL(authUrl({ clientId: "cid", redirectUri: "http://localhost:3000/api/connect/zoom/callback", state: "s", challenge: "c" }));
  assert.equal(url.origin + url.pathname, "https://zoom.us/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(
    grantedScopes("user:read:user cloud_recording:read:list_user_recordings team_chat:read:list_user_messages something:else"),
    ["user:read:user", "cloud_recording:read:list_user_recordings", "team_chat:read:list_user_messages"],
  );
  assert.deepEqual(grantedScopes(undefined), []);
});

test("small helpers", () => {
  assert.equal(apiBase("https://api-eu.zoom.us"), "https://api-eu.zoom.us");
  assert.equal(apiBase("https://evil.example.com"), "https://api.zoom.us");
  assert.equal(apiBase(undefined), "https://api.zoom.us");
  assert.equal(meetingUuidPath("abc+def=="), "abc%2Bdef%3D%3D");
  assert.equal(meetingUuidPath("/abc//def=="), encodeURIComponent(encodeURIComponent("/abc//def==")));
  assert.equal(retryAfterMs("120"), 120_000);
  assert.equal(retryAfterMs(null), null);
  assert.ok(signInRevoked(new ZoomAuthError("invalid_grant")));
  assert.ok(!signInRevoked(new ZoomAuthError("HTTP_503")));
});
