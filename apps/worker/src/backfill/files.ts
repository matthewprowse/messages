// How scripts/encrypt-attachments.ts works out one stored object. Pure, so it is tested without a bucket. `where` is the
// object's place ("attachments/<path>"): a bound file opens only there, and with `bind` a plain one is sealed bound to it.

import { contentHash, decryptBytes, encryptBytes, encryptBytesAt, isSealedBytes, type UserKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";

export interface Planned {
  /** What to upload in place of the object, or null to leave the bytes alone. */
  upload: Uint8Array<ArrayBuffer> | null;
  /** The keyed hash of the plain bytes, for attachments.content_hash. */
  hash: string;
  /** What attachments.sealed should say afterwards. */
  sealed: boolean;
}

const plainOf = async (keys: UserKeys, stored: Uint8Array<ArrayBuffer>, where?: string) =>
  isSealedBytes(stored) ? decryptBytes(keys, FIELD.attachmentData, stored, where) : stored;

/** Encrypt mode: a plain object is sealed; one already sealed is left as it is (its hash is still worked out). */
export async function planSeal(keys: UserKeys, stored: Uint8Array<ArrayBuffer>, where?: string, bind = false): Promise<Planned> {
  const plain = await plainOf(keys, stored, where);
  const hash = await contentHash(keys, plain);
  if (isSealedBytes(stored)) return { upload: null, hash, sealed: true };
  const sealed = bind && where ? await encryptBytesAt(keys, FIELD.attachmentData, where, plain) : await encryptBytes(keys, FIELD.attachmentData, plain);
  // Checked before anything is written: it must open back to exactly the original.
  const back = await decryptBytes(keys, FIELD.attachmentData, sealed, where);
  if (back.length !== plain.length || !back.every((b, i) => b === plain[i])) throw new Error("does not round-trip");
  return { upload: sealed, hash, sealed: true };
}

/** Decrypt mode: a sealed object is opened and put back as plain bytes; a plain one is left as it is. */
export async function planOpen(keys: UserKeys, stored: Uint8Array<ArrayBuffer>, where?: string): Promise<Planned> {
  if (!isSealedBytes(stored)) return { upload: null, hash: await contentHash(keys, stored), sealed: false };
  const plain = await decryptBytes(keys, FIELD.attachmentData, stored, where);
  return { upload: plain, hash: await contentHash(keys, plain), sealed: false };
}
