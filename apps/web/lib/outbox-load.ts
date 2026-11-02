// Turns the user's own queued and failed outbox rows into the same placeholders a send makes in memory, so they show
// again after a reload, and merges them with what is already held. Pure apart from the dismissed list in localStorage.

import type { PendingSend } from "./app-store/compose";

/** A failed row older than this is left alone: the person has long since sent it another way or moved on. */
export const FAILED_SHOWN_DAYS = 7;
export const OUTBOX_LOAD_LIMIT = 50;

export interface OutboxLoadRow {
  id: string;
  thread_id: string | null;
  body: string;
  status: string;
  error: string | null;
  created_at: string;
  from_address: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  attachment_count: number;
}

/** The placeholder for a loaded row (body and addresses already opened), or null when it is not a reply in a conversation. */
export function pendingOfRow(row: OutboxLoadRow): PendingSend | null {
  if (!row.thread_id) return null;
  if (row.status !== "queued" && row.status !== "sending" && row.status !== "failed") return null;
  // An empty list means a plain reply, whose recipients the worker decides; only Reply All stored them.
  const copies = row.to_addresses.length || row.cc_addresses.length ? { to: row.to_addresses, cc: row.cc_addresses } : undefined;
  return {
    id: row.id,
    threadId: row.thread_id,
    body: row.body,
    createdAt: row.created_at,
    status: row.status,
    error: row.error ?? undefined,
    fromAddress: row.from_address ?? undefined,
    copies,
    fileCount: row.attachment_count,
  };
}

/** Which rows to show: not dismissed here, and a failed one only while it is recent. */
export function shownRows(rows: OutboxLoadRow[], dismissed: ReadonlySet<string>, now = Date.now()): PendingSend[] {
  const cutoff = now - FAILED_SHOWN_DAYS * 86_400_000;
  const out: PendingSend[] = [];
  for (const row of rows) {
    if (dismissed.has(row.id)) continue;
    if (row.status === "failed" && Date.parse(row.created_at) < cutoff) continue;
    const p = pendingOfRow(row);
    if (p) out.push(p);
  }
  return out;
}

/** Loaded rows join the held ones. A row already held wins, as it is at least as new as what was read. */
export function mergePending(held: PendingSend[], loaded: PendingSend[]): PendingSend[] {
  const have = new Set(held.map((p) => p.id));
  const add = loaded.filter((p) => !have.has(p.id));
  return add.length ? [...held, ...add] : held;
}

const KEY = "konva.dismissedSends";

/** Failed sends the person deleted here. A row cannot be deleted in the database, so it is remembered in this browser. */
export function readDismissed(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): Set<string> {
  try {
    const raw = storage?.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch { return new Set(); }
}

export function rememberDismissed(id: string, storage: Pick<Storage, "getItem" | "setItem"> | undefined = safeStorage()) {
  try {
    const next = [...readDismissed(storage), id].slice(-200);
    storage?.setItem(KEY, JSON.stringify(next));
  } catch { /* a full or blocked store only means it may show again after a reload */ }
}

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}
