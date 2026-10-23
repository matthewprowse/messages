// Wrapping users' data keys, server side only (the sync worker and the key service). A data key is never
// stored as it is: user_keys holds it encrypted by a key-wrapping key, and `wrapped_by` says which one.
//
// "local:v1" wraps with a 32-byte master key from the environment (KEY_WRAPPING_KEY), AES-256-GCM with the
// user's ID as additional data, so a wrapped key cannot be swapped onto another user. Google Cloud KMS
// takes its place once a project is set up; the stored `wrapped_by` lets both kinds live side by side.
// apps/ai/ai/keys.py unwraps the same way.

import { newDataKey } from "./index";

export interface KeyWrapper {
  /** The `wrapped_by` value written beside keys this wrapper makes. */
  readonly id: string;
  wrap(dataKey: Uint8Array<ArrayBuffer>, userId: string): Promise<string>;
  unwrap(wrapped: string, userId: string): Promise<Uint8Array<ArrayBuffer>>;
}

const subtle = globalThis.crypto.subtle;
const utf8 = new TextEncoder();

/** The local wrapper: AES-256-GCM under a master key given as base64. */
export async function localWrapper(masterKeyBase64: string): Promise<KeyWrapper> {
  const raw = Uint8Array.from(atob(masterKeyBase64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("KEY_WRAPPING_KEY must be 32 bytes, base64 encoded.");
  const master = await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return {
    id: "local:v1",
    async wrap(dataKey, userId) {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(`user_keys:${userId}`) }, master, dataKey));
      const out = new Uint8Array(12 + sealed.length);
      out.set(iv);
      out.set(sealed, 12);
      return btoa(String.fromCharCode(...out));
    },
    async unwrap(wrapped, userId) {
      const bytes = Uint8Array.from(atob(wrapped), (c) => c.charCodeAt(0));
      const key = await subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: utf8.encode(`user_keys:${userId}`) }, master, bytes.subarray(12));
      return new Uint8Array(key);
    },
  };
}

/** The rows a key store reads and writes: user_keys, through whichever database client the caller has. */
export interface KeyStore {
  read(userId: string): Promise<{ wrapped_key: string; wrapped_by: string } | null>;
  /** Inserts unless a key already exists, so two processes racing to create one keep the first. */
  insertIfAbsent(row: { user_id: string; wrapped_key: string; wrapped_by: string }): Promise<void>;
}

/**
 * A user's data key, created on first use. Wrapped keys made by another wrapper are refused rather than
 * guessed at: this process must be configured with every wrapper its users' keys were made with.
 */
export async function dataKeyFor(store: KeyStore, wrappers: KeyWrapper[], userId: string): Promise<Uint8Array<ArrayBuffer>> {
  let row = await store.read(userId);
  if (!row) {
    await store.insertIfAbsent({ user_id: userId, wrapped_key: await wrappers[0].wrap(newDataKey(), userId), wrapped_by: wrappers[0].id });
    row = await store.read(userId);
    if (!row) throw new Error("Could not create a data key.");
  }
  const wrapper = wrappers.find((w) => w.id === row.wrapped_by);
  if (!wrapper) throw new Error(`No key wrapper for ${row.wrapped_by}.`);
  return wrapper.unwrap(row.wrapped_key, userId);
}
