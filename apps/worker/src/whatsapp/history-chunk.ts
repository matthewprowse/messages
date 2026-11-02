// Stores one chunk of WhatsApp history in a single database call. History is not redelivered, so a transient failure
// is retried (./retry.ts), but one lost chunk must not abort the rest of the batch.

import { sleep } from "../backoff";
import { isFailure } from "../ingest/batch-rpc";
import { errorCode, log } from "../log";
import { ingestWhatsAppHistory } from "./ingest";
import type { Prepared } from "./person";
import { retryStore } from "./retry";

/** Returns how many messages in the chunk were new. A chunk that still fails after retries is logged and skipped. */
export async function storeHistoryChunk(accountId: string, chunk: Prepared[]): Promise<number> {
  let inserted = 0;
  let results: Awaited<ReturnType<typeof ingestWhatsAppHistory.run>>;
  try {
    results = await retryStore(() => ingestWhatsAppHistory.run(accountId, chunk.map((p) => p.payload)), sleep);
  } catch (err) {
    log.warn("whatsapp history chunk failed", { account: accountId, code: errorCode(err), messages: chunk.length });
    return 0;
  }
  for (const [i, stored] of results.entries()) {
    if (isFailure(stored)) log.warn("whatsapp history message failed", { account: accountId, code: stored.code });
    else if (chunk[i].finish(stored)) inserted++;
  }
  return inserted;
}
