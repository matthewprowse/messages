// The device copy of the inbox in the browser: IndexedDB plumbing under sealed-copy.ts, and the one SealedCopy the store
// and sign-out share. Privacy model: IndexedDB holds only the non-exportable device CryptoKey and AES-GCM ciphertext,
// never plaintext; sign-out clears both. Without IndexedDB or WebCrypto (some private windows, plain http) there is
// simply no copy and the app loads as before.

import { hasIndexedDb } from "../search/idb-storage";
import { type CopyStorage, SealedCopy } from "./sealed-copy";

const DB_NAME = "konva-copy";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      // Another tab deleting or upgrading the database must not wait on this connection.
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
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

function idbCopyStorage(): CopyStorage {
  let db: Promise<IDBDatabase> | undefined;
  const open = () => (db ??= openDb().catch((error) => { db = undefined; throw error; }));
  return {
    async get(name) {
      const tx = (await open()).transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(name);
      await done(tx);
      return request.result;
    },
    async put(name, value) {
      const tx = (await open()).transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, name);
      await done(tx);
    },
    async clear() {
      const tx = (await open()).transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      await done(tx);
    },
  };
}

let shared: SealedCopy | null | undefined;

/** The device copy, or null where this browser cannot keep one. */
export function deviceCopy(): SealedCopy | null {
  if (shared !== undefined) return shared;
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  shared = typeof window !== "undefined" && hasIndexedDb() && subtle ? new SealedCopy(idbCopyStorage(), subtle) : null;
  return shared;
}

/** Deletes the copy and the device key, for sign-out. Never throws. */
export async function clearLocalCopy(): Promise<void> {
  await deviceCopy()?.clear().catch(() => undefined);
}
