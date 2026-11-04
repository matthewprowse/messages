// The facts about an email that only its headers give, kept in messages.provider_meta at ingest for the AI worker's
// phishing checks (apps/ai/ai/triage_context.py): the receiving server's verdicts and a Reply-To at another domain.
// Pure. A connector that rewrites provider_meta when mail moves folder must carry these over (keepIngestMeta), as the
// headers are not read again.

import type { Json } from "@messages/db";
import type { NormalizedEmail } from "./normalize-email";

/** The provider_meta keys set at ingest from the headers. Code words and a domain only, never an address or text. */
export const INGEST_META_KEYS = ["auth", "reply_to_domain"] as const;

/** The ingest keys for one email; a key is left out when the headers gave nothing. */
export function ingestMeta(mail: Pick<NormalizedEmail, "auth" | "replyToDomain">): Record<string, Json> {
  return {
    ...(mail.auth ? { auth: { ...mail.auth } } : {}),
    ...(mail.replyToDomain ? { reply_to_domain: mail.replyToDomain } : {}),
  };
}

/** next with the ingest keys of the stored provider_meta added back, for a move that builds provider_meta afresh. */
export function keepIngestMeta<T extends Record<string, unknown>>(stored: unknown, next: T): T {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return next;
  const kept: Record<string, unknown> = {};
  for (const key of INGEST_META_KEYS) if ((stored as Record<string, unknown>)[key] !== undefined) kept[key] = (stored as Record<string, unknown>)[key];
  return { ...kept, ...next };
}
