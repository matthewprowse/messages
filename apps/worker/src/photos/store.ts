// Contact and group photos live in the private "avatars" bucket at <user id>/<contact id> (or
// <user id>/thread-<thread id> for a WhatsApp group). Photos from your own address book (iCloud or Google
// Contacts) win over WhatsApp profile pictures, which (and LinkedIn profile pictures) only fill in where there is none.

import { db, must } from "../db";
import { uploadObject } from "../storage";
import { imageType } from "./site-icon";

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;
export type PhotoSource = "icloud" | "google" | "whatsapp" | "linkedin" | "instagram";

async function upload(path: string, bytes: Buffer): Promise<boolean> {
  const type = imageType(bytes);
  if (!type || bytes.length > MAX_BYTES) return false;
  await uploadObject(BUCKET, path, bytes, type);
  return true;
}

/**
 * Saves a contact's photo from this source, unless a higher-priority source already gave one.
 * Null bytes record that the source has no photo now (removing one it gave earlier). Returns whether a
 * photo was stored. `known` is the contact's photo source when the caller has read it already.
 */
export async function saveContactPhoto(
  userId: string,
  contactId: string,
  source: PhotoSource,
  bytes: Buffer | null,
  known?: { avatar_source: string | null },
): Promise<boolean> {
  const current = known ?? (await loadPhotoSource(contactId));
  const rank = (s: string | null) => (s === "icloud" || s === "google" ? 2 : s === "whatsapp" || s === "linkedin" || s === "instagram" ? 1 : 0);
  const now = new Date().toISOString();
  // A photo from another source of the same or higher standing stays: iCloud and Google Contacts never
  // take one from each other (that swapped them back and forth every day), and neither yields to WhatsApp.
  if (rank(current.avatar_source) >= rank(source) && current.avatar_source !== source) return false;

  if (!bytes) {
    // Only the source that gave the photo can take it away.
    if (current.avatar_source === source) {
      must(await db.from("contacts").update({ avatar_path: null, avatar_source: null, avatar_updated_at: now }).eq("id", contactId), "clear contact photo");
    } else {
      must(await db.from("contacts").update({ avatar_updated_at: now }).eq("id", contactId), "mark contact photo checked");
    }
    return false;
  }
  const path = `${userId}/${contactId}`;
  if (!(await upload(path, bytes))) return false;
  must(await db.from("contacts").update({ avatar_path: path, avatar_source: source, avatar_updated_at: now }).eq("id", contactId), "save contact photo");
  return true;
}

async function loadPhotoSource(contactId: string) {
  return must(await db.from("contacts").select("avatar_source").eq("id", contactId).single(), "load contact photo");
}

export async function saveGroupPhoto(userId: string, threadId: string, bytes: Buffer | null): Promise<boolean> {
  const now = new Date().toISOString();
  if (!bytes) {
    must(await db.from("threads").update({ avatar_path: null, avatar_updated_at: now }).eq("id", threadId), "clear group photo");
    return false;
  }
  const path = `${userId}/thread-${threadId}`;
  if (!(await upload(path, bytes))) return false;
  must(await db.from("threads").update({ avatar_path: path, avatar_updated_at: now }).eq("id", threadId), "save group photo");
  return true;
}
