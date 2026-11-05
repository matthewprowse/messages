// How a WhatsApp file reference (media.ts StoredMedia) is stored: the type and mime type plain, since the app and the
// AI worker read them, and the path, key and hashes sealed under the owner's key, since whoever holds those can fetch
// and decrypt the file from WhatsApp's own servers while the link lives (security audit 2026-11-04). Pure: the sealing
// functions are passed in (the vault's seal and open), so this can be tested without a database.

import { FIELD } from "@messages/crypto/fields";
import type { StoredMedia } from "./media";

/** The parts of a reference that let someone fetch the file: sealed together as one value. */
type MediaSecrets = Pick<StoredMedia, "direct_path" | "media_key" | "file_enc_sha256" | "file_sha256">;

/** The vault's seal and open, as sealMediaRef and openMediaRef need them. */
export interface MediaSealer {
  seal(userId: string, field: string, value: string): Promise<string | null>;
  open(userId: string, field: string, value: string): Promise<string | null>;
}

/** The reference as it is stored. With encryption off the vault returns the text as it is, so the shape is the same. */
export async function sealMediaRef(vault: MediaSealer, userId: string, ref: StoredMedia): Promise<StoredMedia> {
  const secrets: MediaSecrets = { direct_path: ref.direct_path, media_key: ref.media_key, file_enc_sha256: ref.file_enc_sha256, file_sha256: ref.file_sha256 };
  // Sealed as a quote, as a poll's vote key is (message-payload.ts): free text under the owner's key.
  const sealed = await vault.seal(userId, FIELD.quote, JSON.stringify(secrets));
  if (!sealed) return ref;
  return { type: ref.type, url: null, direct_path: null, media_key: null, file_enc_sha256: null, file_sha256: null, mimetype: ref.mimetype, sealed };
}

/** A stored reference with its sealed parts opened, or as it is for a row written before they were sealed. */
export async function openMediaRef(vault: MediaSealer, userId: string, stored: StoredMedia): Promise<StoredMedia> {
  if (!stored.sealed) return stored;
  const text = await vault.open(userId, FIELD.quote, stored.sealed);
  if (!text) return { ...stored, direct_path: null, media_key: null }; // unreadable: downloadable() refuses it, nothing is fetched
  return { ...stored, ...(JSON.parse(text) as MediaSecrets) };
}
