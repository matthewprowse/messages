// The search index's bytes in IndexedDB: one database, one store, sealed shards in it (see sealed-store.ts). This file
// is only the browser plumbing; it never sees plaintext, and the logic above it is tested against a Map instead.

import type { ByteStorage } from "./sealed-store";

const DB_NAME = "konva-search";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Opens (and on first use creates) the index database. Works in a page and in a worker. */
export function idbStorage(): ByteStorage {
  let db: Promise<IDBDatabase> | undefined;
  const open = () => (db ??= openDb());
  return {
    async get(key) {
      const tx = (await open()).transaction(STORE, "readonly");
      return (await result(tx.objectStore(STORE).get(key))) as Uint8Array | undefined;
    },
    async putMany(entries) {
      const tx = (await open()).transaction(STORE, "readwrite");
      for (const [key, value] of entries) tx.objectStore(STORE).put(value, key);
      await done(tx);
    },
    async delMany(keys) {
      const tx = (await open()).transaction(STORE, "readwrite");
      for (const key of keys) tx.objectStore(STORE).delete(key);
      await done(tx);
    },
    async keys() {
      const tx = (await open()).transaction(STORE, "readonly");
      return (await result(tx.objectStore(STORE).getAllKeys())).map(String);
    },
    async clear() {
      const tx = (await open()).transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      await done(tx);
    },
  };
}

/** Whether IndexedDB can be used here (not in some private windows and old browsers). */
export function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}
