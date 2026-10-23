import { errorCode, log } from "../log";
import { chunks } from "../util";

// Bulk storage for first syncs and history imports: a chunk of messages per database call
// (public.ingest_email_batch, public.ingest_whatsapp_batch) instead of one call each. Until that
// migration is applied, and whenever a batch call fails as a whole, messages go one call at a time
// as before.

/** How often a batch function that was missing is looked for again. */
export const BATCH_RECHECK_MS = 10 * 60_000;

/** A message that could not be stored. The rest of its chunk is stored regardless. */
export interface RowFailure {
  failed: true;
  /** A SQLSTATE or error code, never the message itself. */
  code: string;
}

export function isFailure(row: unknown): row is RowFailure {
  return !!row && typeof row === "object" && (row as RowFailure).failed === true;
}

/** What a PostgREST call returns, loosely: enough to tell a missing function from other failures. */
export interface RpcResponse {
  data: unknown;
  error: { code?: string } | null;
  status: number;
}

/** Whether the database does not have this function yet: its migration has not been applied. */
export function functionMissing(response: Pick<RpcResponse, "error" | "status">): boolean {
  return !!response.error && (response.error.code === "PGRST202" || response.status === 404);
}

/**
 * A batch function that wraps a single-message one. Rows go in chunks of `size`, in order, and come
 * back in the same order, each the single function's result or a RowFailure. A chunk of one goes
 * through the single function, so live messages never use the batch.
 */
export class BatchRpc<P, R> {
  private missingUntil = 0;

  constructor(
    private readonly name: string,
    private readonly size: number,
    private readonly many: (accountId: string, rows: P[]) => PromiseLike<RpcResponse>,
    /** The single-message call. Throws on failure. */
    private readonly one: (accountId: string, row: P) => Promise<R>,
    private readonly now: () => number = Date.now,
  ) {}

  async run(accountId: string, rows: P[]): Promise<(R | RowFailure)[]> {
    const out: (R | RowFailure)[] = [];
    for (const chunk of chunks(rows, this.size)) out.push(...(await this.chunk(accountId, chunk)));
    return out;
  }

  private async chunk(accountId: string, rows: P[]): Promise<(R | RowFailure)[]> {
    if (rows.length > 1 && this.now() >= this.missingUntil) {
      const response = await this.many(accountId, rows);
      if (!response.error && Array.isArray(response.data) && response.data.length === rows.length) {
        return response.data.map((r: unknown) =>
          (r as { result?: string }).result === "error" ? { failed: true as const, code: String((r as { code?: unknown }).code ?? "unknown") } : (r as R),
        );
      }
      if (functionMissing(response)) {
        this.missingUntil = this.now() + BATCH_RECHECK_MS;
        log.warn("batch function missing, storing one at a time", { rpc: this.name, recheckMs: BATCH_RECHECK_MS });
      } else {
        // A failed call is one transaction that stored nothing; if only its answer was lost, storing each
        // row again just finds it there. So going one at a time is safe either way.
        log.warn("batch call failed, storing one at a time", { rpc: this.name, code: response.error?.code || "bad_result", rows: rows.length });
      }
    }
    const out: (R | RowFailure)[] = [];
    for (const row of rows) {
      try {
        out.push(await this.one(accountId, row));
      } catch (err) {
        out.push({ failed: true, code: errorCode(err) });
      }
    }
    return out;
  }
}
