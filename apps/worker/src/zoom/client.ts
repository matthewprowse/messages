// A small authorised fetch for the Zoom REST API, the twin of microsoft/client.ts. Access tokens last an hour;
// this keeps one and refreshes it shortly before it runs out, or at once if Zoom says it is no longer valid.
// Each refresh brings a new refresh token, handed to onRotate so it can be kept. A request Zoom turns away for
// going too fast (429) is tried again after Retry-After, a few times, before it fails with the wait Zoom asked
// for, so the connector can back off for that long.

import { sleep } from "../backoff";
import { retryDelay } from "../google/client";
import { DEFAULT_API_URL, ZoomAuthError, apiBase, refreshAccessToken } from "./oauth";

/** Zoom's own code for an access token it no longer accepts, sent with a 401 or 400. */
const INVALID_TOKEN = 124;
/** The most redirects followed for a file download. */
const MAX_REDIRECTS = 5;

/** A failed Zoom API call. `status` is the HTTP status; `zoomCode` is Zoom's own, e.g. 3001 "Meeting does not exist". */
export class ZoomApiError extends Error {
  readonly code: string;
  constructor(readonly status: number, readonly zoomCode: number | null, readonly retryAfterMs: number | null = null) {
    super(`zoom request failed: ${status}`);
    this.code = `HTTP_${status}`;
  }
}

export interface ZoomRequest {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

/** What the syncs need from Zoom, so they can be unit tested on recorded replies. */
export interface ZoomApi {
  request<T>(path: string, init?: ZoomRequest): Promise<T>;
  download(url: string): Promise<Buffer>;
}

export class ZoomClient implements ZoomApi {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string> | null = null;
  private api = DEFAULT_API_URL;

  constructor(
    private readonly opts: { clientId: string; clientSecret: string; refreshToken: string; apiUrl?: string },
    /** Called with each new refresh token Zoom issues. A failure here is logged by the caller, not thrown. */
    private readonly onRotate: (refreshToken: string) => Promise<void> = async () => undefined,
  ) {
    this.api = apiBase(opts.apiUrl);
  }

  /** A valid access token. Requests made at the same time share one refresh, which matters more here than
   *  anywhere: two refreshes with the same refresh token would leave one of them holding a spent token. */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    this.refreshing ??= refreshAccessToken(this.opts)
      .then(async (result) => {
        this.accessToken = result.access_token;
        this.expiresAt = Date.now() + result.expires_in * 1000;
        if (result.api_url) this.api = apiBase(result.api_url);
        if (result.refresh_token && result.refresh_token !== this.opts.refreshToken) {
          this.opts.refreshToken = result.refresh_token;
          await this.onRotate(result.refresh_token);
        }
        return result.access_token;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** Calls the API and returns its JSON, or undefined for an empty reply (204). `path` is under /v2. */
  async request<T>(path: string, init: ZoomRequest = {}): Promise<T> {
    const target = new URL(`${this.api}/v2${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) if (value !== undefined) target.searchParams.set(key, String(value));
    const response = await this.send(target, init);
    if (response.status === 204) {
      await response.body?.cancel().catch(() => undefined);
      return undefined as T;
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * A recording file's bytes from its download_url. The URL redirects to a signed copy elsewhere, so redirects
   * are followed by hand: the access token goes only to Zoom's own hosts, never to wherever a redirect points.
   */
  async download(url: string): Promise<Buffer> {
    let target = new URL(url);
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      if (target.protocol !== "https:") throw new ZoomApiError(400, null);
      const zoomHost = /(^|\.)zoom\.us$/.test(target.hostname);
      const response = zoomHost
        ? await this.send(target, { timeoutMs: 300_000 }, "manual")
        : await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(300_000) });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        target = new URL(location, target);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ZoomApiError(response.status, null);
      }
      return Buffer.from(await response.arrayBuffer());
    }
    throw new ZoomApiError(310, null);
  }

  /**
   * One request with retries. Throttling (429) is retried after Retry-After, since Zoom refused it before doing
   * anything; a server error only for a GET. An access token Zoom turns down is refreshed once.
   */
  private async send(target: URL, init: ZoomRequest, redirect: "follow" | "manual" = "follow"): Promise<Response> {
    const method = init.method ?? "GET";
    let refreshed = false;
    for (let retries = 0; ; ) {
      const response = await fetch(target, {
        method,
        redirect,
        headers: {
          authorization: `Bearer ${await this.token()}`,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
      });
      if (response.ok || (response.status >= 300 && response.status < 400)) return response;

      const json = (await response.json().catch(() => ({}))) as { code?: number };
      const zoomCode = typeof json.code === "number" ? json.code : null;
      if ((response.status === 401 || zoomCode === INVALID_TOKEN) && !refreshed) {
        refreshed = true;
        this.accessToken = null; // revoked or expired early: refresh once and retry
        continue;
      }
      const retryAfter = response.headers.get("retry-after");
      const delay = retryDelay({ status: response.status, reason: null, method, attempt: retries, retryAfter });
      if (delay === null) throw new ZoomApiError(response.status, zoomCode, response.status === 429 ? retryAfterMs(retryAfter) : null);
      retries++;
      await sleep(delay);
    }
  }
}

/** How long Zoom asked us to wait, in seconds or as a date. Daily limits name the next day. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

/** True when the stored sign-in no longer works and only reconnecting will fix it. */
export function signInRevoked(err: unknown): boolean {
  return err instanceof ZoomAuthError && ["invalid_grant", "invalid_client", "unauthorized_client", "invalid_request"].includes(err.code);
}

/** True when Zoom is rate limiting this account. */
export function rateLimited(err: unknown): err is ZoomApiError {
  return err instanceof ZoomApiError && err.status === 429;
}

/** Zoom's escape for a meeting UUID in a path: twice when it starts with "/" or holds "//", else once. */
export function meetingUuidPath(uuid: string): string {
  const once = encodeURIComponent(uuid);
  return uuid.startsWith("/") || uuid.includes("//") ? encodeURIComponent(once) : once;
}
