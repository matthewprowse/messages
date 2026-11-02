// Keeps the search index on disk encrypted. Documents are grouped into 512 shards by a hash of their id, and each shard
// is sealed on its own with AES-GCM under the user's field key (packages/crypto), with its name bound in as additional
// data so one shard cannot be swapped for another. A change rewrites only the shards it touched. The storage underneath
// is a plain key to bytes interface (IndexedDB in the browser, a Map in tests), and sees nothing but ciphertext.
//
// If the key cannot open what is stored (a different user, a rotated key, a damaged shard) everything is cleared and the
// caller rebuilds from the server. Nothing is ever migrated: the index is a cache.

import { decryptBytes, encryptBytes, type UserKeys } from "@messages/crypto";
import type { Doc } from "./types";

/** A key to bytes store. Everything handed to it is already sealed. */
export interface ByteStorage {
  get(key: string): Promise<Uint8Array | undefined>;
  putMany(entries: [string, Uint8Array][]): Promise<void>;
  delMany(keys: string[]): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** An in-memory ByteStorage, for tests and for browsers without IndexedDB (nothing is kept past the tab). */
export function memoryStorage(): ByteStorage & { raw: Map<string, Uint8Array> } {
  const raw = new Map<string, Uint8Array>();
  return {
    raw,
    get: async (key) => raw.get(key),
    putMany: async (entries) => { for (const [k, v] of entries) raw.set(k, v); },
    delMany: async (keys) => { for (const k of keys) raw.delete(k); },
    keys: async () => [...raw.keys()],
    clear: async () => { raw.clear(); },
  };
}

export const SHARDS = 512;
const VERSION = 1;
const META_KEY = "meta";
const shardKey = (n: number) => `s${n}`;

/** Which shard a document lives in. FNV-1a, so the same id always lands in the same place. */
export function shardOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return (h >>> 0) % SHARDS;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

async function seal(keys: UserKeys, name: string, value: unknown): Promise<Uint8Array> {
  return encryptBytes(keys, `search:${name}`, utf8.encode(JSON.stringify(value)));
}

async function unseal<T>(keys: UserKeys, name: string, bytes: Uint8Array): Promise<T> {
  const plain = await decryptBytes(keys, `search:${name}`, bytes as Uint8Array<ArrayBuffer>);
  return JSON.parse(fromUtf8.decode(plain)) as T;
}

interface Meta { v: number; userId: string; data: unknown }

export interface Loaded {
  docs: Doc[];
  /** What the caller last saved with setMeta, or null for a fresh index. */
  meta: unknown;
  /** Something was stored but could not be opened with this key, so it was cleared. */
  rebuilt: boolean;
}

export class SealedStore {
  private members = new Map<number, Set<string>>();
  private dirty = new Set<number>();
  private metaDirty = false;
  private meta: unknown = null;

  constructor(private storage: ByteStorage, private keys: UserKeys, private userId: string) {}

  /** Reads and opens everything stored. On any failure the storage is cleared and an empty index returned. */
  async load(): Promise<Loaded> {
    const names = await this.storage.keys();
    if (names.length === 0) return { docs: [], meta: null, rebuilt: false };
    try {
      const bytes = await this.storage.get(META_KEY);
      if (!bytes) throw new Error("no meta");
      const meta = await unseal<Meta>(this.keys, META_KEY, bytes);
      if (meta.v !== VERSION || meta.userId !== this.userId) throw new Error("other index");
      const docs: Doc[] = [];
      for (const name of names) {
        if (name === META_KEY) continue;
        const n = Number(name.slice(1));
        const shard = await this.storage.get(name);
        if (!shard || !Number.isInteger(n)) throw new Error("bad shard");
        const list = await unseal<Doc[]>(this.keys, name, shard);
        docs.push(...list);
        this.members.set(n, new Set(list.map((d) => d.id)));
      }
      this.meta = meta.data;
      return { docs, meta: meta.data, rebuilt: false };
    } catch {
      await this.clear();
      return { docs: [], meta: null, rebuilt: true };
    }
  }

  /** Remembers that these documents were added or changed, so their shards are rewritten by the next flush. */
  markUpserted(ids: string[]) {
    for (const id of ids) {
      const n = shardOf(id);
      let set = this.members.get(n);
      if (!set) this.members.set(n, (set = new Set()));
      set.add(id);
      this.dirty.add(n);
    }
  }

  markRemoved(ids: string[]) {
    for (const id of ids) {
      const n = shardOf(id);
      this.members.get(n)?.delete(id);
      this.dirty.add(n);
    }
  }

  /** Sets the small record kept beside the shards (where loading got to). Written by the next flush. */
  setMeta(data: unknown) {
    this.meta = data;
    this.metaDirty = true;
  }

  get pending() { return this.dirty.size > 0 || this.metaDirty; }

  /** Writes every shard that changed since the last flush. `get` finds a document by id. */
  async flush(get: (id: string) => Doc | undefined) {
    if (!this.pending) return;
    const shards = [...this.dirty];
    const writeMeta = this.metaDirty || shards.length > 0;
    this.dirty.clear();
    this.metaDirty = false;
    const put: [string, Uint8Array][] = [];
    const del: string[] = [];
    try {
      for (const n of shards) {
        const docs = [...(this.members.get(n) ?? [])].flatMap((id) => get(id) ?? []);
        if (docs.length === 0) del.push(shardKey(n));
        else put.push([shardKey(n), await seal(this.keys, shardKey(n), docs)]);
      }
      // The meta goes with the first write, so a store that has shards always has the record that proves whose they are.
      if (writeMeta) put.push([META_KEY, await seal(this.keys, META_KEY, { v: VERSION, userId: this.userId, data: this.meta } satisfies Meta)]);
      await this.storage.putMany(put);
      if (del.length) await this.storage.delMany(del);
    } catch (error) {
      // Try the same shards again next time rather than losing the change.
      for (const n of shards) this.dirty.add(n);
      this.metaDirty = true;
      throw error;
    }
  }

  /** Deletes everything stored, for sign-out or a key that no longer opens it. */
  async clear() {
    this.members.clear();
    this.dirty.clear();
    this.metaDirty = false;
    this.meta = null;
    await this.storage.clear();
  }
}
