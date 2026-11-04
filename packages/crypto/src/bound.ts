// The bound value format ("e2:", "t2:" and "e2b:" files): a sealed value that also names where it is stored, so it opens
// only for its owner, and a reader that drives an action (a send, a calendar write) can check it was sealed for the very
// column and row it read it from. index.ts uses this file for every value it seals or opens; apps/ai/ai/crypto.py
// mirrors it, and bound-vectors.json pins both.
//
// A field: "e2:" (a user's key) or "t2:" (a team's key) + base64(place length u8 | place | row length u8 | row | nonce
// 12 bytes | ciphertext | GCM tag 16 bytes), AES-256-GCM under the same field keys as "e1:"/"t1:". The additional data
// is "e2|user:<user id>|<field>|<place>|<row>" ("t2|team:<workspace id>|..." for a team's), so a value cannot be moved to
// another user or workspace, another kind of text, another column or another row, and its place cannot be edited.
//   place  "<table>.<column>", such as "outbox.body", or "" when the writer did not say (a generic writer).
//   row    the row it belongs to (its id, or another id that names it, such as "<outbox id>:<storage path>"), or "".
// The place travels with the value (authenticated, not secret: it is the column's own name) because the database copies
// some values between tables (a message's subject into its thread) and most readers only know the kind of text they
// read. A strict reader (openExpected) names the places and the row it accepts and refuses anything else.
//
// A file: MAGIC "e2b:" 00 FF "KN" | nonce 12 bytes | ciphertext | GCM tag 16 bytes, the additional data
// "e2b|user:<user id>|<field>|<where>" (team: "e2b|team:<workspace id>|..."), where is "<bucket>/<object path>" for a
// stored object. A reader always knows where it downloaded a file from, so the path is not repeated inside it: a sealed
// file copied to another path, or another user's folder, does not open.

const subtle = globalThis.crypto.subtle;
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8", { fatal: true });

type Key = Awaited<ReturnType<typeof subtle.importKey>>;

export const BOUND_PREFIX = "e2:";
export const TEAM_BOUND_PREFIX = "t2:";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLACE = 100;
const MAX_ROW = 200;
const PLACE = /^([a-z0-9_]+\.[a-z0-9_]+)?$/;
const ROW = /^[A-Za-z0-9_.:/@ -]*$/;

/** Where a value is stored: "<table>.<column>", and the row it belongs to when the writer knows it. */
export interface Place {
  place: string;
  row?: string | null;
}

/** A place with no row, for a writer that cannot know the row's id (the database makes it). */
export const at = (table: string, column: string, row?: string | null): Place => ({ place: `${table}.${column}`, row: row ?? null });

/** Whose key sealed a value: a user's, or a workspace's. Part of the additional data. */
export type Owner = { user: string } | { team: string };

const ownerTag = (o: Owner) => ("user" in o ? `user:${o.user}` : `team:${o.team}`);

/** An error with a stable code for callers to branch on. The message never includes a value. */
export function boundError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function checkPlace(p: Place): { place: string; row: string } {
  const row = p.row ?? "";
  if (!PLACE.test(p.place) || p.place.length > MAX_PLACE) throw boundError("bad_place", "A place is <table>.<column>.");
  if (!ROW.test(row) || row.length > MAX_ROW) throw boundError("bad_place", "A row id has letters, digits and . : / @ - _ only.");
  return { place: p.place, row };
}

const fieldAad = (prefix: string, owner: Owner, field: string, place: string, row: string) =>
  utf8.encode(`${prefix.slice(0, 2)}|${ownerTag(owner)}|${field}|${place}|${row}`);

/** Seals text for one owner, field and place as "e2:" or "t2:" (by prefix). A nonce is only passed by the test vectors. */
export async function sealPlaced(enc: Key, prefix: string, owner: Owner, field: string, where: Place, plaintext: string, nonce?: Uint8Array<ArrayBuffer>): Promise<string> {
  const { place, row } = checkPlace(where);
  const iv = nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  if (iv.length !== NONCE_BYTES) throw new Error("A nonce is 12 bytes.");
  const p = utf8.encode(place);
  const r = utf8.encode(row);
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: fieldAad(prefix, owner, field, place, row) }, enc, utf8.encode(plaintext)));
  const out = new Uint8Array(2 + p.length + r.length + NONCE_BYTES + sealed.length);
  let i = 0;
  out[i++] = p.length;
  out.set(p, i);
  i += p.length;
  out[i++] = r.length;
  out.set(r, i);
  i += r.length;
  out.set(iv, i);
  out.set(sealed, i + NONCE_BYTES);
  return prefix + toBase64(out);
}

interface Parsed extends Required<Place> {
  row: string;
  iv: Uint8Array<ArrayBuffer>;
  body: Uint8Array<ArrayBuffer>;
}

function parse(prefix: string, payload: string): Parsed {
  const bytes = fromBase64(payload.slice(prefix.length));
  const pLen = bytes[0] ?? 0;
  const rAt = 1 + pLen;
  const rLen = bytes[rAt] ?? 0;
  const ivAt = rAt + 1 + rLen;
  if (bytes.length < ivAt + NONCE_BYTES + TAG_BYTES) throw boundError("unreadable", "Encrypted value is too short.");
  const place = fromUtf8.decode(bytes.subarray(1, rAt));
  const row = fromUtf8.decode(bytes.subarray(rAt + 1, ivAt));
  return { place, row, iv: bytes.slice(ivAt, ivAt + NONCE_BYTES), body: bytes.slice(ivAt + NONCE_BYTES) };
}

/**
 * Where a bound value says it was sealed for, or null when it is not one. Read without a key: trust it only after the
 * value has opened (the place is authenticated then), or to refuse early.
 */
export function placeOf(payload: string): { place: string; row: string } | null {
  if (typeof payload !== "string" || !(payload.startsWith(BOUND_PREFIX) || payload.startsWith(TEAM_BOUND_PREFIX))) return null;
  try {
    const { place, row } = parse(BOUND_PREFIX, payload);
    return { place, row };
  } catch {
    return null;
  }
}

/** What a strict reader accepts: the places a value may have been sealed for and, when given, the one row. */
export interface Expect {
  places: readonly string[];
  /** The row the value must be bound to. Undefined: not checked. */
  row?: string;
}

/** Refuses a bound value sealed for another place or row, with the code sealed_elsewhere. */
export function checkExpected(found: { place: string; row: string }, expect: Expect): void {
  if (!expect.places.includes(found.place)) throw boundError("sealed_elsewhere", "This value was sealed for another place.");
  if (expect.row !== undefined && found.row !== expect.row) throw boundError("sealed_elsewhere", "This value was sealed for another row.");
}

/** Opens an "e2:" or "t2:" value for this owner and field, checking `expect` first when given. Throws if it will not open. */
export async function openPlaced(enc: Key, prefix: string, owner: Owner, field: string, payload: string, expect?: Expect): Promise<string> {
  const v = parse(prefix, payload);
  if (expect) checkExpected(v, expect);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: v.iv, additionalData: fieldAad(prefix, owner, field, v.place, v.row) }, enc, v.body);
  return fromUtf8.decode(plain);
}

// Files ---------------------------------------------------------------------------------------------------------

/** "e2b:" 00 FF "KN": the header of a bound sealed file. The legacy header is "e1b:" 00 FF "KN" (index.ts). */
export const BOUND_MAGIC = Uint8Array.of(0x65, 0x32, 0x62, 0x3a, 0x00, 0xff, 0x4b, 0x4e);

const fileAad = (owner: Owner, field: string, where: string) => utf8.encode(`e2b|${ownerTag(owner)}|${field}|${where}`);

/** Whether these bytes (or the first few of them) start with the bound sealed-file header. */
export function isBoundBytes(bytes: Uint8Array): boolean {
  return bytes.length >= BOUND_MAGIC.length && BOUND_MAGIC.every((b, i) => bytes[i] === b);
}

/** Seals a file's bytes for one owner, field and storage place ("<bucket>/<path>"). A nonce is only passed by tests. */
export async function sealFileAt(enc: Key, owner: Owner, field: string, where: string, plain: Uint8Array<ArrayBuffer>, nonce?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!where) throw boundError("bad_place", "A sealed file needs the place it is stored.");
  const iv = nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  if (iv.length !== NONCE_BYTES) throw new Error("A nonce is 12 bytes.");
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: fileAad(owner, field, where) }, enc, plain));
  const out = new Uint8Array(BOUND_MAGIC.length + NONCE_BYTES + sealed.length);
  out.set(BOUND_MAGIC);
  out.set(iv, BOUND_MAGIC.length);
  out.set(sealed, BOUND_MAGIC.length + NONCE_BYTES);
  return out;
}

/** Opens bytes sealed by sealFileAt for the same owner, field and place. Throws if they were altered or moved. */
export async function openFileAt(enc: Key, owner: Owner, field: string, where: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!isBoundBytes(sealed)) throw boundError("unreadable", "Not a bound sealed file.");
  const start = BOUND_MAGIC.length + NONCE_BYTES;
  if (sealed.length < start + TAG_BYTES) throw boundError("unreadable", "Sealed file is too short.");
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(BOUND_MAGIC.length, start), additionalData: fileAad(owner, field, where) }, enc, sealed.subarray(start));
  return new Uint8Array(plain);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
