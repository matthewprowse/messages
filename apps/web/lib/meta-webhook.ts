// Meta's webhook rules for the Instagram connector, as plain functions so the route (app/api/meta/webhook) stays
// thin and every rule is tested: the verify handshake, the X-Hub-Signature-256 check, and turning a payload into
// hints. A hint says only "this professional account has news" (its numeric ID and the kind of event), never who
// wrote or what, because the connector reads the conversation itself and nothing about a message belongs here.

import { createHmac, timingSafeEqual } from "node:crypto";

export type HintKind = "message" | "seen" | "reaction" | "other";
export interface Hint { igUserId: string; kind: HintKind }

/** Meta sends small payloads; anything larger is not from Meta. */
export const MAX_BODY_BYTES = 256 * 1024;

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The GET Meta makes when you save the callback URL: it echoes back hub.challenge only when hub.verify_token is the
 * one set in the environment. Returns the challenge to answer with, or null to refuse (also when no token is set,
 * so an unconfigured server never answers the handshake).
 */
export function verifyChallenge(params: URLSearchParams, token: string | undefined): string | null {
  if (!token || params.get("hub.mode") !== "subscribe") return null;
  const given = params.get("hub.verify_token"), challenge = params.get("hub.challenge");
  if (!given || !challenge || !same(given, token)) return null;
  return challenge;
}

/** Whether `header` (sha256=<hex>) is the HMAC-SHA256 of the raw body under the app secret. Constant time. */
export function validSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return same(m[1].toLowerCase(), expected);
}

const idOf = (v: unknown): string | null => {
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  return /^\d{1,40}$/.test(s) ? s : null;
};

/**
 * The hints a payload carries, one per account and kind however many events there were. Only messaging events count
 * (comments and mentions come in `changes` and are not read here), and an echo of a message the account itself sent
 * is skipped: the connector stored that when it sent it.
 */
export function hintsFromPayload(payload: unknown): Hint[] {
  const body = payload as { object?: unknown; entry?: unknown } | null;
  if (!body || body.object !== "instagram" || !Array.isArray(body.entry)) return [];
  const seen = new Set<string>(), out: Hint[] = [];
  for (const entry of body.entry as ({ id?: unknown; messaging?: unknown } | null)[]) {
    const igUserId = idOf(entry?.id);
    if (!entry || !igUserId || !Array.isArray(entry.messaging)) continue;
    for (const ev of entry.messaging as (Record<string, unknown> | null)[]) {
      const kind = kindOf(ev);
      if (!kind) continue;
      const key = `${igUserId}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ igUserId, kind });
    }
  }
  return out;
}

function kindOf(ev: Record<string, unknown> | null): HintKind | null {
  if (!ev || typeof ev !== "object") return null;
  const message = ev.message as { is_echo?: unknown } | undefined;
  if (message && typeof message === "object") return message.is_echo === true ? null : "message";
  if (ev.read) return "seen";
  if (ev.reaction) return "reaction";
  return "other";
}
