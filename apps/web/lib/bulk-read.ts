// Readable Bulk Email in the app: parsing the AI's readable version of a newsletter or marketing email, and asking for it
// when the email is opened. The version is made by the AI worker on request (apps/ai/ai/bulk_read.py), so opening an email
// inserts a row in bulk_reads and checks every moment until message_ai.bulk_read has the result or the row carries an
// error. The calls are passed in so this can be tested without a database.

export const BULK_POLL_MS = 1500;
export const BULK_GIVE_UP_MS = 45_000;

export const BULK_TEXT = {
  cannotAsk: "The Request Could Not Be Made. Check Your Connection and Try Again.",
  slow: "This Is Taking Longer Than Expected. Try Again in a Moment.",
} as const;

export interface ReadableBulk {
  summary: string;
  points: string[];
  links: { label: string; url: string }[];
}

/** message_ai.bulk_read, opened, as a readable version: null when it is missing or not in the expected shape. Only web addresses are kept. */
export function parseBulkRead(json: string | null | undefined): ReadableBulk | null {
  if (!json) return null;
  let raw: { summary?: unknown; points?: unknown; links?: unknown };
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw.summary !== "string" || !raw.summary.trim()) return null;
  const points = (Array.isArray(raw.points) ? raw.points : []).filter((p): p is string => typeof p === "string" && p.trim() !== "");
  const links = (Array.isArray(raw.links) ? raw.links : []).filter(
    (l): l is { label: string; url: string } => !!l && typeof l.label === "string" && l.label.trim() !== "" && typeof l.url === "string" && /^https?:\/\//i.test(l.url),
  );
  return { summary: raw.summary, points, links: links.map((l) => ({ label: l.label, url: l.url })) };
}

/** Whether to offer a readable version: bulk email that has not been cut down to a preview. */
export function canRead(m: { bulk?: boolean; bodyShrunk?: boolean; whatsapp?: boolean }): boolean {
  return !!m.bulk && !m.bodyShrunk && !m.whatsapp;
}

export type BulkOutcome = { kind: "ready"; read: ReadableBulk } | { kind: "error"; message: string; retry: boolean };

export interface BulkApi {
  /** The stored readable version, or null when there is none yet. */
  stored(messageId: string): Promise<ReadableBulk | null>;
  /** Makes the request. `again` first removes a failed one. Resolves false when it could not be made. A request that already exists counts as made. */
  request(messageId: string, again: boolean): Promise<boolean>;
  /** The worker's message on the request row, if it failed. */
  failure(messageId: string): Promise<string | null>;
  wait(ms: number): Promise<void>;
  visible(): boolean;
}

/** Shows a stored version at once; otherwise asks for one and waits. Stops early (returning null) when `stopped()` turns true. */
export async function loadBulkRead(api: BulkApi, messageId: string, again: boolean, stopped: () => boolean, pollMs = BULK_POLL_MS, giveUpMs = BULK_GIVE_UP_MS): Promise<BulkOutcome | null> {
  if (!again) {
    const have = await api.stored(messageId).catch(() => null);
    if (stopped()) return null;
    if (have) return { kind: "ready", read: have };
  }
  const made = await api.request(messageId, again).catch(() => false);
  if (stopped()) return null;
  if (!made) return { kind: "error", message: BULK_TEXT.cannotAsk, retry: true };
  // Only time spent looking counts: a hidden tab pauses the clock instead of giving up.
  let waited = 0;
  for (;;) {
    if (api.visible()) {
      const [read, failure] = await Promise.all([api.stored(messageId).catch(() => null), api.failure(messageId).catch(() => null)]);
      if (stopped()) return null;
      if (read) return { kind: "ready", read };
      if (failure) return { kind: "error", message: failure, retry: true };
      if (waited >= giveUpMs) return { kind: "error", message: BULK_TEXT.slow, retry: true };
      waited += pollMs;
    }
    await api.wait(pollMs);
    if (stopped()) return null;
  }
}
