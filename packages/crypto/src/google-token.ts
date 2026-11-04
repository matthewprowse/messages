// Bearer tokens for Google APIs (Cloud KMS, Pub/Sub) without an SDK, server side only. wrap.ts uses it for the KMS
// wrapper and re-exports it. Where a token comes from, in order:
//  1. Workload Identity Federation (GCP_WORKLOAD_IDENTITY_PROVIDER): the Vercel function's OIDC token is exchanged at
//     Google STS for a federated token, which then impersonates GCP_SERVICE_ACCOUNT_EMAIL (iamcredentials
//     generateAccessToken). Nothing secret is stored: Vercel signs a short-lived token per deployment, and Google trusts
//     only the issuer, audience and subject the provider names. For the web app on Vercel.
//  2. GOOGLE_APPLICATION_CREDENTIALS_JSON (or the file named by GOOGLE_APPLICATION_CREDENTIALS): a service account key,
//     exchanged for a token with a signed JWT. Kept for the developer's machine and until Vercel is switched to 1.
//  3. KMS_ACCESS_TOKEN: a token given as it is (for a quick test with `gcloud auth print-access-token`).
//  4. The metadata server, which is how a Confidential Space or other Google Cloud VM (the workers) gets its identity.
// Tokens are cached until a minute before they expire, and concurrent callers share one refresh. No token, and no part of
// a Google answer, is ever put in an error or a log: errors carry a status and a stable code only.

/** A token call that takes longer than this is abandoned: a hung request must not hold every unwrap behind it. */
export const KMS_TIMEOUT_MS = 10_000;

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_URL = "https://iamcredentials.googleapis.com/v1";
/** How long an impersonated token is asked for. Google's default and maximum without extra org policy. */
const IMPERSONATED_LIFETIME_S = 3600;

type Env = Record<string, string | undefined>;

const subtle = globalThis.crypto.subtle;
const utf8 = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromB64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const b64url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const failed = (message: string, code: string) => Object.assign(new Error(message), { code });

export interface TokenOptions {
  /**
   * The OIDC token of this Vercel function, for Workload Identity Federation. Defaults to vercelOidcToken (the
   * request's x-vercel-oidc-token header, then VERCEL_OIDC_TOKEN). Tests pass their own.
   */
  oidcToken?: () => string | undefined | Promise<string | undefined>;
  now?: () => number;
}

/**
 * The OIDC token Vercel gives this function: the `x-vercel-oidc-token` header of the request being served (read from
 * Vercel's request context, the way @vercel/functions getVercelOidcToken reads it), else VERCEL_OIDC_TOKEN (set in
 * builds, and by `vercel env pull` for local development). Undefined outside Vercel.
 */
export function vercelOidcToken(env: Env = process.env): string | undefined {
  const holder = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] as
    | { get?: () => { headers?: Record<string, string | string[] | undefined> } | undefined }
    | undefined;
  const header = holder?.get?.()?.headers?.["x-vercel-oidc-token"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return fromHeader || env.VERCEL_OIDC_TOKEN || undefined;
}

/** Whether this process is set up to use Workload Identity Federation (step 1 above). */
export const usesWorkloadIdentity = (env: Env = process.env) => !!env.GCP_WORKLOAD_IDENTITY_PROVIDER?.trim();

/**
 * The STS audience for a provider given as its resource name ("projects/<number>/locations/global/workloadIdentityPools/
 * <pool>/providers/<provider>"), with or without the "//iam.googleapis.com/" in front.
 */
export function stsAudience(provider: string): string {
  const name = provider.trim().replace(/^\/\/iam\.googleapis\.com\//, "").replace(/^\/+/, "");
  if (!/^projects\/[^/]+\/locations\/global\/workloadIdentityPools\/[^/]+\/providers\/[^/]+$/.test(name)) {
    throw failed("GCP_WORKLOAD_IDENTITY_PROVIDER must be projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>.", "wif_bad_provider");
  }
  return `//iam.googleapis.com/${name}`;
}

type Fetched = { token: string; ttlS: number };

/** Workload Identity Federation: the OIDC token for a federated token at STS, then (when a service account is named) an impersonated one. */
async function federatedToken(env: Env, doFetch: typeof fetch, oidc: string | undefined, now: () => number): Promise<Fetched> {
  if (!oidc) throw failed("No Vercel OIDC token: turn on OIDC Federation in the Vercel project, or unset GCP_WORKLOAD_IDENTITY_PROVIDER.", "wif_no_oidc_token");
  const res = await doFetch(STS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: stsAudience(env.GCP_WORKLOAD_IDENTITY_PROVIDER ?? ""),
      scope: SCOPE,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: oidc,
    }),
    signal: AbortSignal.timeout(KMS_TIMEOUT_MS),
  });
  if (!res.ok) throw failed(`Google STS token exchange failed (${res.status}).`, `sts_${res.status}`);
  const sts = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!sts.access_token) throw failed("Google STS returned no token.", "sts_empty");
  const account = env.GCP_SERVICE_ACCOUNT_EMAIL?.trim();
  // Without a service account the federated token is used as it is: KMS must then grant the pool's principal directly.
  if (!account) return { token: sts.access_token, ttlS: sts.expires_in ?? 3600 };
  const iam = await doFetch(`${IAM_URL}/projects/-/serviceAccounts/${encodeURIComponent(account)}:generateAccessToken`, {
    method: "POST",
    headers: { authorization: `Bearer ${sts.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ scope: [SCOPE], lifetime: `${IMPERSONATED_LIFETIME_S}s` }),
    signal: AbortSignal.timeout(KMS_TIMEOUT_MS),
  });
  if (!iam.ok) throw failed(`Service account impersonation failed (${iam.status}).`, `iam_${iam.status}`);
  const out = (await iam.json()) as { accessToken?: string; expireTime?: string };
  if (!out.accessToken) throw failed("Service account impersonation returned no token.", "iam_empty");
  const expires = out.expireTime ? Date.parse(out.expireTime) : NaN;
  return { token: out.accessToken, ttlS: Number.isFinite(expires) ? Math.max(0, (expires - now()) / 1000) : IMPERSONATED_LIFETIME_S };
}

/** A service account key exchanged for a token with a signed JWT. */
async function serviceAccountToken(json: string, doFetch: typeof fetch): Promise<Fetched> {
  const account = JSON.parse(json) as { client_email: string; private_key: string; token_uri?: string };
  const aud = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: account.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 };
  const unsigned = `${b64url(utf8.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(utf8.encode(JSON.stringify(claims)))}`;
  const pem = account.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const key = await subtle.importKey("pkcs8", fromB64(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await subtle.sign("RSASSA-PKCS1-v1_5", key, utf8.encode(unsigned)));
  const res = await doFetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(KMS_TIMEOUT_MS),
  });
  if (!res.ok) throw failed(`Google token request failed (${res.status}).`, `google_token_${res.status}`);
  const out = (await res.json()) as { access_token: string; expires_in?: number };
  return { token: out.access_token, ttlS: out.expires_in ?? 3600 };
}

/** A bearer token for Google APIs, cached until a minute before it expires. See the header for where it comes from. */
export function googleAccessToken(env: Env = process.env, doFetch: typeof fetch = globalThis.fetch, opts: TokenOptions = {}): () => Promise<string> {
  const now = opts.now ?? Date.now;
  let cached: { token: string; until: number } | null = null;
  const fetchToken = async (): Promise<Fetched> => {
    if (usesWorkloadIdentity(env)) return federatedToken(env, doFetch, await (opts.oidcToken ?? (() => vercelOidcToken(env)))(), now);
    let json = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!json && env.GOOGLE_APPLICATION_CREDENTIALS) {
      const fs = await import("node:fs/promises");
      json = await fs.readFile(env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    }
    if (json) return serviceAccountToken(json, doFetch);
    if (env.KMS_ACCESS_TOKEN) return { token: env.KMS_ACCESS_TOKEN, ttlS: 300 };
    const host = env.GCE_METADATA_HOST || "metadata.google.internal";
    const res = await doFetch(`http://${host}/computeMetadata/v1/instance/service-accounts/default/token`, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(KMS_TIMEOUT_MS) });
    if (!res.ok) throw failed(`Metadata server token request failed (${res.status}).`, `metadata_${res.status}`);
    const out = (await res.json()) as { access_token: string; expires_in?: number };
    return { token: out.access_token, ttlS: out.expires_in ?? 300 };
  };
  let refreshing: Promise<string> | null = null; // concurrent callers share one refresh
  return async () => {
    if (cached && cached.until > now()) return cached.token;
    refreshing ??= fetchToken().then(({ token, ttlS }) => {
      cached = { token, until: now() + Math.max(0, ttlS - 60) * 1000 };
      return token;
    }).finally(() => { refreshing = null; });
    return refreshing;
  };
}
