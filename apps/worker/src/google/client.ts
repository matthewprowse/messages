// A small authorised fetch for Google's REST APIs. Access tokens last an hour; this keeps one and
// refreshes it shortly before it runs out, or at once if Google says it is no longer valid. A request
// Google turns away for going too fast, or a read that hits a server error, is tried again after a pause,
// so one busy moment does not end a whole sync session.

import { sleep } from "../backoff";
import { GoogleAuthError, refreshAccessToken } from "./oauth";

/** Waits before each retry: 1 s, 2 s, then 4 s, give or take a fifth. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
/** The longest a Retry-After header may make a call wait. */
const MAX_RETRY_AFTER_MS = 30_000;
/** Google's reasons for "too many requests" sent as a 403. Daily quota errors are not among them: they do not pass in seconds. */
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RESOURCE_EXHAUSTED"]);

/**
 * How long to wait before trying a failed request again, or null to give up. A rate limit is always
 * safe to retry: Google refused the request before doing anything. A server error is retried only for
 * a GET, since a send or a change may have gone through before the error. Retry-After, in seconds or
 * as a date, wins when Google sends it.
 */
export function retryDelay(opts: { status: number; reason: string | null; method: string; attempt: number; retryAfter: string | null; now?: number }): number | null {
  if (opts.attempt >= RETRY_DELAYS_MS.length) return null;
  const limited = opts.status === 429 || (opts.status === 403 && opts.reason !== null && RATE_REASONS.has(opts.reason));
  const flaky = opts.method === "GET" && opts.status >= 500 && opts.status <= 599;
  if (!limited && !flaky) return null;
  if (opts.retryAfter) {
    const now = opts.now ?? Date.now();
    const seconds = Number(opts.retryAfter);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(opts.retryAfter) - now;
    if (Number.isFinite(ms)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
  }
  return Math.round(RETRY_DELAYS_MS[opts.attempt]! * (0.8 + Math.random() * 0.4));
}

/** A failed Google API call. `status` is the HTTP status; `reason` is Google's own reason, e.g. "rateLimitExceeded". */
export class GoogleApiError extends Error {
  readonly code: string;
  constructor(readonly status: number, readonly reason: string | null) {
    super(`google api request failed: ${status}`);
    this.code = `HTTP_${status}`;
  }
}

/** A request body sent as bytes, such as a whole email for Gmail's upload endpoint. */
export interface RawBody {
  contentType: string;
  data: Buffer;
}

/** The bytes as fetch takes them, without copying a large email again. */
function rawView(data: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
}

export class GoogleClient {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private readonly opts: { clientId: string; clientSecret: string; refreshToken: string }) {}

  private refreshing: Promise<string> | null = null;

  /** A valid access token. Requests made at the same time share one refresh instead of each asking Google. */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    this.refreshing ??= refreshAccessToken(this.opts)
      .then((result) => {
        this.accessToken = result.access_token;
        this.expiresAt = Date.now() + result.expires_in * 1000;
        return result.access_token;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /**
   * Calls a Google API and returns its JSON. Query values that are arrays repeat the parameter. `body`
   * is sent as JSON; `raw` sends bytes as they are, with their own content type (media uploads).
   * Rate limits, and server errors on a GET, are retried a few times (see retryDelay) before the call fails.
   */
  async request<T>(
    url: string,
    init: {
      method?: string;
      query?: Record<string, string | number | boolean | string[] | undefined>;
      body?: unknown;
      raw?: RawBody;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) target.searchParams.append(key, String(v));
    }

    const method = init.method ?? "GET";
    let refreshed = false;
    for (let retries = 0; ; ) {
      const response = await fetch(target, {
        method,
        headers: {
          authorization: `Bearer ${await this.token()}`,
          ...(init.raw ? { "content-type": init.raw.contentType } : init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.raw ? rawView(init.raw.data) : init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
      });
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.accessToken = null; // revoked or expired early: refresh once and retry
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[]; status?: string } };
        const reason = json.error?.errors?.[0]?.reason ?? json.error?.status ?? null;
        const delay = retryDelay({ status: response.status, reason, method, attempt: retries, retryAfter: response.headers.get("retry-after") });
        if (delay === null) throw new GoogleApiError(response.status, reason);
        retries++;
        await sleep(delay);
        continue;
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
  }
}

/** True when the stored sign-in no longer works and only reconnecting will fix it. */
export function signInRevoked(err: unknown): boolean {
  return err instanceof GoogleAuthError && (err.code === "invalid_grant" || err.code === "unauthorized_client" || err.code === "invalid_client");
}
