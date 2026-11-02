// The page's side of the search index: starts the worker, sends it requests and gives back promises. One index per tab.
// If a Web Worker cannot be made, the same host runs on the page instead (slower to type against a big index, but the same
// results). Search text goes to the worker and nowhere else: nothing here touches the network.

import type { UserKeys } from "@messages/crypto";
import { createHost } from "./host";
import { hasIndexedDb, idbStorage } from "./idb-storage";
import type { Counts, Envelope, InitReply, Reply, Request } from "./protocol";
import { parseQuery } from "./query";
import { memoryStorage } from "./sealed-store";
import type { Doc, Kind, SearchResult } from "./types";

interface Backend {
  post(env: Envelope): void;
  terminate(): void;
}

let backend: Backend | null = null;
let ready = false;
let nextId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function onReply(reply: Reply) {
  const p = pending.get(reply.id);
  if (!p) return;
  pending.delete(reply.id);
  if (reply.ok) p.resolve(reply.value);
  else p.reject(new Error("Search failed."));
}

function failAll() {
  for (const p of pending.values()) p.reject(new Error("Search stopped."));
  pending.clear();
}

function start(): Backend {
  try {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<Reply>) => onReply(event.data);
    worker.onerror = () => failAll();
    return { post: (env) => worker.postMessage(env), terminate: () => worker.terminate() };
  } catch {
    const storage = hasIndexedDb() ? idbStorage() : memoryStorage();
    const host = createHost(() => storage, onReply);
    return { post: (env) => host.handle(env), terminate: () => undefined };
  }
}

function send<T>(req: Request): Promise<T> {
  const b = backend;
  if (!b) return Promise.reject(new Error("Search is not open."));
  return new Promise<T>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    b.post({ id, req });
  });
}

/** Opens the index for this user, replacing any open one. Resolves with what was stored. */
export async function openIndex(keys: UserKeys, userId: string): Promise<InitReply> {
  closeIndex();
  backend = start();
  const reply = await send<InitReply>({ t: "init", keys, userId });
  ready = true;
  return reply;
}

/** Stops the worker and drops the in-memory index. What is stored stays, sealed, for the next session. */
export function closeIndex() {
  ready = false;
  failAll();
  backend?.terminate();
  backend = null;
}

/** Deletes the stored index and the one in memory: for sign-out. Works whether or not the index was opened. */
export async function wipeIndex() {
  if (backend) {
    try { await send({ t: "clear" }); } catch { /* the storage is cleared directly below */ }
  }
  closeIndex();
  if (hasIndexedDb()) {
    try { await idbStorage().clear(); } catch { /* nothing stored, or storage blocked */ }
  }
}

/** Whether the index is open and can be searched (it may still be filling). */
export function indexReady() {
  return ready;
}

export const upsertDocs = (docs: Doc[]) => send<Counts>({ t: "upsert", docs });
export const removeDocs = (ids: string[]) => send<Counts>({ t: "remove", ids });
export const removeMessages = (refs: string[]) => send<Counts>({ t: "removeMessages", refs });
export const knownIds = (ids: string[]) => send<string[]>({ t: "known", ids });
export const stampsOf = (kind: Kind) => send<[string, number][]>({ t: "stamps", kind });
export const saveMeta = (data: unknown) => send<null>({ t: "meta", data });
export const flushIndex = () => send<null>({ t: "flush" });

/** Searches what was typed. Null when the index is not open yet or the search failed: callers fall back to the loaded data. */
export async function searchIndex(text: string, limits: Partial<Record<Kind, number>>): Promise<SearchResult | null> {
  if (!ready) return null;
  const q = parseQuery(text);
  if (q.empty) return null;
  try { return await send<SearchResult>({ t: "search", q, limits }); } catch { return null; }
}

/** The ids of conversations matching what was typed, directly or through a message or file. Null when it cannot be answered. */
export async function searchThreadIds(text: string): Promise<Set<string> | null> {
  if (!ready) return null;
  const q = parseQuery(text);
  if (q.empty) return null;
  try { return new Set(await send<string[]>({ t: "threads", q })); } catch { return null; }
}
