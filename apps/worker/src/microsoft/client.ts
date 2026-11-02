// A small authorised fetch for Microsoft Graph, the twin of google/client.ts. Access tokens last about an
// hour; this keeps one and refreshes it shortly before it runs out, or at once if Graph says it is no
// longer valid. Each refresh brings a new refresh token, handed to onRotate so it can be kept. Every
// request asks for immutable IDs, so a message keeps its ID when it moves between folders.

import { sleep } from "../backoff";
import { retryDelay } from "../google/client";
import { errorCode, log } from "../log";
import { MicrosoftAuthError, refreshAccessToken } from "./oauth";

export const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * A failed Graph call. `status` is the HTTP status; `graphCode` is Graph's own, e.g. "ErrorItemNotFound";
 * `retryAfter` is Graph's Retry-After header, when it sent one with a throttled reply.
 */
export class GraphApiError extends Error {
  readonly code: string;
  constructor(readonly status: number, readonly graphCode: string | null, readonly retryAfter: string | null = null) {
    super(`graph request failed: ${status}`);
    this.code = `HTTP_${status}`;
  }
}

/** A request body sent as bytes or text with its own content type, such as an email as MIME. */
export interface RawBody {
  contentType: string;
  data: Buffer | string;
}

function rawView(data: Buffer | string): Uint8Array<ArrayBuffer> | string {
  if (typeof data === "string") return data;
  return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
}

export interface GraphRequest {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  raw?: RawBody;
  /** Extra Prefer values, e.g. 'odata.maxpagesize=200' or 'outlook.timezone="UTC"'. */
  prefer?: string[];
  timeoutMs?: number;
}

export class GraphClient {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string> | null = null;
  /** A rotated refresh token the last onRotate could not save: kept in memory (opts) and saved again at the next refresh. */
  private unsaved = false;

  constructor(
    /** extraScopes: the optional scopes the sign-in granted, asked for again on each refresh. */
    private readonly opts: { clientId: string; clientSecret: string; refreshToken: string; extraScopes?: string[] },
    /** Called with each new refresh token Microsoft issues. A failure here is logged by the caller, not thrown. */
    private readonly onRotate: (refreshToken: string) => Promise<void> = async () => undefined,
  ) {}

  /** A valid access token. Requests made at the same time share one refresh instead of each asking Microsoft. */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    this.refreshing ??= refreshAccessToken(this.opts)
      .then(async (result) => {
        this.accessToken = result.access_token;
        this.expiresAt = Date.now() + result.expires_in * 1000;
        if (result.refresh_token && result.refresh_token !== this.opts.refreshToken) {
          this.opts.refreshToken = result.refresh_token;
          this.unsaved = true;
        }
        // The access token is good whether or not saving the new refresh token works, so a save failure must not
        // fail the request. The new token stays in memory and the save is tried again at the next refresh.
        if (this.unsaved) {
          try {
            await this.onRotate(this.opts.refreshToken);
            this.unsaved = false;
          } catch (err) {
            log.warn("microsoft refresh token not saved", { code: errorCode(err) });
          }
        }
        return result.access_token;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** Calls Graph and returns its JSON, or undefined for an empty reply (202, 204). `url` is a path under v1.0 or a full nextLink. */
  async request<T>(url: string, init: GraphRequest = {}): Promise<T> {
    const response = await this.send(url, init);
    if (response.status === 202 || response.status === 204) {
      await response.body?.cancel().catch(() => undefined);
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  /** Calls Graph and returns the reply's bytes, such as a message's MIME from /messages/{id}/$value. */
  async bytes(url: string, init: GraphRequest = {}): Promise<Buffer> {
    const response = await this.send(url, init);
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * One request with retries. Throttling (429) is always retried, after Retry-After when Graph sends it,
   * since Graph refused the request before doing anything. A server error is retried only for a GET.
   */
  private async send(url: string, init: GraphRequest): Promise<Response> {
    const target = new URL(url.startsWith("https://") ? url : `${GRAPH}${url}`);
    for (const [key, value] of Object.entries(init.query ?? {})) if (value !== undefined) target.searchParams.set(key, String(value));
    const method = init.method ?? "GET";
    const prefer = ['IdType="ImmutableId"', ...(init.prefer ?? [])].join(", ");

    let refreshed = false;
    for (let retries = 0; ; ) {
      const response = await fetch(target, {
        method,
        headers: {
          authorization: `Bearer ${await this.token()}`,
          prefer,
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
        const json = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
        const graphCode = json.error?.code ?? null;
        const retryAfter = response.headers.get("retry-after");
        const delay = retryDelay({ status: response.status, reason: null, method, attempt: retries, retryAfter });
        if (delay === null) throw new GraphApiError(response.status, graphCode, retryAfter);
        retries++;
        await sleep(delay);
        continue;
      }
      return response;
    }
  }
}

/**
 * Uploads one piece of a large attachment to an upload session. The session URL carries its own
 * permission, so it must be sent without the access token.
 */
export async function putChunk(uploadUrl: string, chunk: Buffer, start: number, total: number): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "content-range": `bytes ${start}-${start + chunk.length - 1}/${total}` },
    body: rawView(chunk),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    throw new GraphApiError(response.status, json.error?.code ?? null);
  }
  await response.body?.cancel().catch(() => undefined);
}

/** True when the stored sign-in no longer works and only reconnecting will fix it. */
export function signInRevoked(err: unknown): boolean {
  return (
    err instanceof MicrosoftAuthError &&
    ["invalid_grant", "interaction_required", "consent_required", "unauthorized_client", "invalid_client"].includes(err.code)
  );
}
