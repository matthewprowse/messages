// Decisions that keep a send from going out twice or being retried when it may already have gone: whether Enter in a
// single-line field may submit, which failures allow Retry, and the one outbox id an unsettled message keeps.
// Pure: the store, the compose dialogs and thread-view call it; the tests pin the rules down.

/** The worker's wording when a send was cut off or handed to the provider and the answer was lost. */
const UNSURE = /may have been sent|sent folder|sent items|was interrupted|might have been sent/i;

/** What a failed send allows. "unsure": it may have gone out, so no Retry. "retry": definitely not sent. */
export type SendRecovery = "retry" | "unsure" | "none";

/** Unsure failures never offer Retry; a definite one does unless files were attached (they cannot be re-queued here). */
export function sendRecovery(error: string | undefined, fileCount: number): SendRecovery {
  if (error && UNSURE.test(error)) return "unsure";
  return fileCount > 0 ? "none" : "retry";
}

/**
 * Whether Enter in this element would submit the surrounding form by accident. Only single-line inputs do;
 * a textarea keeps its newline and a button keeps its click. Cmd or Ctrl Enter is the deliberate send, handled by the field.
 */
export function enterSubmitsByAccident(key: string, tag: string, type?: string): boolean {
  if (key !== "Enter" || tag.toUpperCase() !== "INPUT") return false;
  return type !== "submit" && type !== "button" && type !== "checkbox" && type !== "radio";
}

/** The part of a message that makes it "the same message" when the user sends it again after a failed attempt. */
export function sendSignature(parts: { scope: string; body: string; from?: string | null; to?: string[]; cc?: string[]; bcc?: string[]; subject?: string; files?: number; draftId?: string | null }): string {
  return JSON.stringify([parts.scope, parts.body, parts.from ?? "", parts.to ?? [], parts.cc ?? [], parts.bcc ?? [], parts.subject ?? "", parts.files ?? 0, parts.draftId ?? ""]);
}

/**
 * Hands out one outbox id per unsettled message. The browser picks the id, so pressing Send again after a lost
 * response inserts the same row (a duplicate key, treated as success) instead of a second one. begin() says when the
 * same message is already being inserted, so a double click does nothing.
 */
export function createSendKeys(newId: () => string = () => crypto.randomUUID()) {
  const ids = new Map<string, string>();
  const busy = new Set<string>();
  return {
    begin(signature: string): { id: string; busy: boolean } {
      let id = ids.get(signature);
      if (!id) { id = newId(); ids.set(signature, id); }
      const was = busy.has(signature);
      busy.add(signature);
      return { id, busy: was };
    },
    /** settled: the row is known to exist, so the next identical message is a new one. Otherwise the id is kept for the retry. */
    end(signature: string, settled: boolean) {
      busy.delete(signature);
      if (settled) ids.delete(signature);
    },
  };
}

interface Result<T> { data: T | null; error: { code?: string } | null }

/**
 * Inserts a row whose id the caller chose. A duplicate key means an earlier try went through (its answer was lost),
 * so the row is read back and counts as success. Any other error is a failure.
 */
export async function insertOnce<T>(insert: () => PromiseLike<Result<T>>, lookup: () => PromiseLike<Result<T>>): Promise<{ data: T | null; error: boolean }> {
  const first = await insert();
  if (!first.error && first.data) return { data: first.data, error: false };
  if (first.error?.code !== "23505") return { data: null, error: true };
  const found = await lookup();
  return found.data ? { data: found.data, error: false } : { data: null, error: true };
}
