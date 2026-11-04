// The copy of the conversation list kept on this device, so the inbox shows the instant the app opens instead of after
// a second of loading. Privacy model: the copy is sealed with AES-GCM under a device key that WebCrypto made with
// extractable false, so the key's bytes can never be read, not even by this code. Only the CryptoKey object and the
// ciphertext are stored; nothing decrypted is ever written. The signed-in user's id and the format version are bound in
// as additional data, so another user's copy (or an older format) fails to open. Sign-out deletes the copy and the key.
//
// The copy is a cache: anything that will not open (another user, another version, a damaged record) is deleted along
// with the key, never migrated. It holds the list, contacts and small tables; message bodies are never in it.

import type { Loaded } from "../data/load-threads";
import { trimCopy } from "./snapshot";

/** What the copy holds: what loadEverything returns, less the flag about the contacts load. */
export type CopyData = Omit<Loaded, "contactsLoaded">;

/** A store of structured-clone values (IndexedDB in the browser, a Map in tests). Sees only ciphertext and the key object. */
export interface CopyStorage {
  get(name: string): Promise<unknown>;
  put(name: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

/** An in-memory CopyStorage, for tests. */
export function memoryCopyStorage(): CopyStorage & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return {
    raw,
    get: async (name) => raw.get(name),
    put: async (name, value) => { raw.set(name, value); },
    clear: async () => { raw.clear(); },
  };
}

/** The format the copy is written in. Bump it whenever CopyData changes shape, and older copies are dropped. */
export const COPY_VERSION = 1;
/** Most plaintext bytes kept. A thousand conversations with their people is well under 2 MB; past this the oldest go. */
export const MAX_COPY_BYTES = 6_000_000;
const KEY = "device-key";
const COPY = "copy";

interface Stored { v: number; iv: Uint8Array; data: Uint8Array }
interface Envelope { v: number; userId: string; savedAt: string; data: CopyData }

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();
const aad = (v: number, userId: string) => utf8.encode(`konva-local-copy:${v}:${userId}`);
const isCryptoKey = (k: unknown): k is CryptoKey => typeof k === "object" && k !== null && (k as CryptoKey).type === "secret" && (k as CryptoKey).algorithm?.name === "AES-GCM";
const isStored = (r: unknown): r is Stored => typeof r === "object" && r !== null && typeof (r as Stored).v === "number" && (r as Stored).iv instanceof Uint8Array && (r as Stored).data instanceof Uint8Array;
const LISTS = ["threads", "contacts", "accounts", "rules", "writingExamples", "unsubscribes", "tasks"] as const;
const isCopyData = (d: unknown): d is CopyData => typeof d === "object" && d !== null && LISTS.every((k) => Array.isArray((d as CopyData)[k])) && typeof (d as CopyData).profile === "object" && (d as CopyData).profile !== null;

export class SealedCopy {
  /** Goes up on every clear, so a save that started before a sign-out never writes after it. */
  private generation = 0;
  /** The user whose copy was last opened. Saves are for that user only, and none after a sign-out until the next open. */
  private owner: string | null = null;

  constructor(private storage: CopyStorage, private subtle: SubtleCrypto, private opts: { version?: number; maxBytes?: number } = {}) {}

  private get version() { return this.opts.version ?? COPY_VERSION; }

  /** The copy saved for this user, or null when there is none. Anything that does not open is deleted, key and all. */
  async open(userId: string): Promise<CopyData | null> {
    this.owner = userId;
    const generation = this.generation;
    try {
      const record = await this.storage.get(COPY);
      if (record === undefined) return null;
      const key = await this.storage.get(KEY);
      if (!isStored(record) || record.v !== this.version || !isCryptoKey(key)) throw new Error("unusable copy");
      const plain = await this.subtle.decrypt({ name: "AES-GCM", iv: record.iv as Uint8Array<ArrayBuffer>, additionalData: aad(record.v, userId) }, key, record.data as Uint8Array<ArrayBuffer>);
      const envelope = JSON.parse(fromUtf8.decode(plain)) as Envelope;
      if (envelope.v !== this.version || envelope.userId !== userId || !isCopyData(envelope.data)) throw new Error("other copy");
      return generation === this.generation ? envelope.data : null;
    } catch {
      await this.wipe().catch(() => undefined);
      return null;
    }
  }

  /**
   * Seals and stores the copy for this user, replacing the last one. Over the size cap the oldest conversations are
   * left out. Resolves false when nothing was written: signed out or cleared meanwhile, another user's copy is open, or
   * it is too large even when trimmed.
   */
  async save(userId: string, data: CopyData, now = new Date()): Promise<boolean> {
    const generation = this.generation;
    if (this.owner !== userId) return false;
    const plain = encodeWithin({ v: this.version, userId, savedAt: now.toISOString(), data }, this.opts.maxBytes ?? MAX_COPY_BYTES);
    if (!plain) return false;
    const key = await this.deviceKey(generation);
    if (!key) return false;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await this.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(this.version, userId) }, key, plain));
    if (generation !== this.generation) return false;
    await this.storage.put(COPY, { v: this.version, iv, data: sealed } satisfies Stored);
    return true;
  }

  /** Deletes the copy and the device key, for sign-out. Nothing is saved again until a user's copy is opened. */
  async clear() {
    this.owner = null;
    await this.wipe();
  }

  /** Deletes the copy and the device key, and stops any save already under way from writing. */
  private async wipe() {
    this.generation++;
    await this.storage.clear();
  }

  /** The stored device key, made on first use. Read back after writing, so two tabs racing settle on one key. */
  private async deviceKey(generation: number): Promise<CryptoKey | null> {
    const held = await this.storage.get(KEY);
    if (isCryptoKey(held)) return held;
    const made = await this.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    if (generation !== this.generation) return null;
    await this.storage.put(KEY, made);
    const stored = await this.storage.get(KEY);
    return isCryptoKey(stored) ? stored : null;
  }
}

/** The envelope as UTF-8, with the oldest conversations halved away until it fits. Null when even none fit. */
function encodeWithin(envelope: Envelope, maxBytes: number): Uint8Array<ArrayBuffer> | null {
  let keep = envelope.data.threads.length;
  for (;;) {
    const data = keep === envelope.data.threads.length ? envelope.data : trimCopy(envelope.data, keep);
    const bytes = utf8.encode(JSON.stringify({ ...envelope, data }));
    if (bytes.length <= maxBytes) return bytes;
    if (keep === 0) return null;
    keep = Math.floor(keep / 2);
  }
}
