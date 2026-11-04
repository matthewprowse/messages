// Tests for crypto/google-token.ts: Workload Identity Federation from a Vercel OIDC token (STS exchange, then service
// account impersonation), its caching and failure codes, and reading Vercel's request context, against a fake fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { googleAccessToken, stsAudience, usesWorkloadIdentity, vercelOidcToken } from "./google-token";

const PROVIDER = "projects/123456/locations/global/workloadIdentityPools/vercel/providers/konva";
const ACCOUNT = "konva-web@messages-keys.iam.gserviceaccount.com";

type Call = { url: string; init?: RequestInit };

function fakeGoogle(opts: { stsStatus?: number; iamStatus?: number; expireTime?: string } = {}) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("https://sts.googleapis.com/")) {
      if (opts.stsStatus) return new Response('{"error":"secret detail"}', { status: opts.stsStatus });
      return new Response(JSON.stringify({ access_token: "federated", token_type: "Bearer", expires_in: 3600 }));
    }
    if (url.startsWith("https://iamcredentials.googleapis.com/")) {
      if (opts.iamStatus) return new Response('{"error":"secret detail"}', { status: opts.iamStatus });
      return new Response(JSON.stringify({ accessToken: "impersonated", expireTime: opts.expireTime ?? "2026-11-03T13:00:00Z" }));
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

test("a Vercel OIDC token is exchanged at STS and then impersonates the service account", async () => {
  const google = fakeGoogle();
  const now = () => Date.parse("2026-11-03T12:00:00Z");
  const token = googleAccessToken({ GCP_WORKLOAD_IDENTITY_PROVIDER: PROVIDER, GCP_SERVICE_ACCOUNT_EMAIL: ACCOUNT }, google.fetch, { oidcToken: () => "vercel-oidc", now });
  assert.equal(await token(), "impersonated");
  const [sts, iam] = google.calls;
  const form = new URLSearchParams(String(sts.init?.body));
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
  assert.equal(form.get("audience"), `//iam.googleapis.com/${PROVIDER}`);
  assert.equal(form.get("subject_token"), "vercel-oidc");
  assert.equal(form.get("subject_token_type"), "urn:ietf:params:oauth:token-type:jwt");
  assert.equal(form.get("scope"), "https://www.googleapis.com/auth/cloud-platform");
  assert.equal(iam.url, `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(ACCOUNT)}:generateAccessToken`);
  assert.equal(new Headers(iam.init?.headers).get("authorization"), "Bearer federated");
  assert.deepEqual(JSON.parse(String(iam.init?.body)).scope, ["https://www.googleapis.com/auth/cloud-platform"]);
  assert.ok(sts.init?.signal && iam.init?.signal, "both calls carry a timeout");
});

test("the impersonated token is cached until a minute before it expires, then fetched again", async () => {
  const google = fakeGoogle({ expireTime: "2026-11-03T13:00:00Z" });
  let at = Date.parse("2026-11-03T12:00:00Z");
  const token = googleAccessToken({ GCP_WORKLOAD_IDENTITY_PROVIDER: PROVIDER, GCP_SERVICE_ACCOUNT_EMAIL: ACCOUNT }, google.fetch, { oidcToken: () => "o", now: () => at });
  await Promise.all([token(), token(), token()]);
  assert.equal(google.calls.length, 2, "one STS and one impersonation call for three callers");
  at = Date.parse("2026-11-03T12:58:00Z");
  await token();
  assert.equal(google.calls.length, 2);
  at = Date.parse("2026-11-03T12:59:30Z");
  await token();
  assert.equal(google.calls.length, 4);
});

test("without a service account the federated token is used as it is", async () => {
  const google = fakeGoogle();
  const token = googleAccessToken({ GCP_WORKLOAD_IDENTITY_PROVIDER: `//iam.googleapis.com/${PROVIDER}` }, google.fetch, { oidcToken: async () => "o" });
  assert.equal(await token(), "federated");
  assert.equal(google.calls.length, 1);
});

test("federation wins over a service account key, so switching only needs the new settings", async () => {
  const google = fakeGoogle();
  const env = { GCP_WORKLOAD_IDENTITY_PROVIDER: PROVIDER, GCP_SERVICE_ACCOUNT_EMAIL: ACCOUNT, GOOGLE_APPLICATION_CREDENTIALS_JSON: "{not json" };
  assert.equal(await googleAccessToken(env, google.fetch, { oidcToken: () => "o" })(), "impersonated");
  assert.equal(usesWorkloadIdentity(env), true);
  assert.equal(usesWorkloadIdentity({ GCP_WORKLOAD_IDENTITY_PROVIDER: " " }), false);
});

test("federation failures carry a status code and nothing from Google's answer, and are not cached", async () => {
  const env = { GCP_WORKLOAD_IDENTITY_PROVIDER: PROVIDER, GCP_SERVICE_ACCOUNT_EMAIL: ACCOUNT };
  const noOidc = googleAccessToken(env, fakeGoogle().fetch, { oidcToken: () => undefined });
  await assert.rejects(noOidc(), (err: { code?: string }) => err.code === "wif_no_oidc_token");
  const sts = googleAccessToken(env, fakeGoogle({ stsStatus: 400 }).fetch, { oidcToken: () => "o" });
  await assert.rejects(sts(), (err: Error & { code?: string }) => err.code === "sts_400" && !err.message.includes("secret"));
  const google = fakeGoogle({ iamStatus: 403 });
  const iam = googleAccessToken(env, google.fetch, { oidcToken: () => "o" });
  await assert.rejects(iam(), (err: Error & { code?: string }) => err.code === "iam_403" && !err.message.includes("secret"));
  await assert.rejects(iam());
  assert.equal(google.calls.length, 4, "a failure is tried again by the next caller");
});

test("the provider must be a full resource name", () => {
  assert.equal(stsAudience(PROVIDER), `//iam.googleapis.com/${PROVIDER}`);
  assert.throws(() => stsAudience("vercel/konva"), (err: { code?: string }) => err.code === "wif_bad_provider");
});

test("the OIDC token comes from Vercel's request context first, then VERCEL_OIDC_TOKEN", () => {
  const slot = Symbol.for("@vercel/request-context");
  const holder = globalThis as unknown as Record<symbol, unknown>;
  assert.equal(vercelOidcToken({}), undefined);
  assert.equal(vercelOidcToken({ VERCEL_OIDC_TOKEN: "from-env" }), "from-env");
  holder[slot] = { get: () => ({ headers: { "x-vercel-oidc-token": "from-header" } }) };
  try {
    assert.equal(vercelOidcToken({ VERCEL_OIDC_TOKEN: "from-env" }), "from-header");
  } finally {
    delete holder[slot];
  }
});
