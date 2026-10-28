import { imageType } from "../photos/site-icon";
import type { Helper } from "./helper";

// LinkedIn profile pictures as contact photos. Which people are due one, and the fetch itself, which the
// helper makes (through the account's proxy, from LinkedIn's image servers only); the connector looks the
// contacts up and saves the photo (src/photos/store.ts). Pure apart from the helper call, so it can be unit
// tested.

export const PHOTO_FRESH_MS = 7 * 24 * 60 * 60_000; // a LinkedIn photo is fetched again after a week
export const RETRY_MS = 60 * 60_000; // a picture that did not work is not tried again for an hour
const MAX_BYTES = 2 * 1024 * 1024;

export interface ContactPhoto {
  avatar_path: string | null;
  avatar_source: string | null;
  avatar_updated_at: string | null;
}

/**
 * Whether a contact should get this picture now. A contact with a photo from anywhere else keeps it (an
 * address book photo is better, and WhatsApp's stays); one with no photo takes it, unless it was checked
 * within the week; one with a LinkedIn photo gets a fresh one once the week is up.
 */
export function photoDue(contact: ContactPhoto | undefined, now = Date.now()): boolean {
  if (!contact) return false;
  if (contact.avatar_path && contact.avatar_source !== "linkedin") return false;
  const at = contact.avatar_updated_at ? Date.parse(contact.avatar_updated_at) : NaN;
  return !(at > now - PHOTO_FRESH_MS);
}

/** The people worth a lookup: those with a picture, once, and not yourself. */
export function withPictures<T extends { id: string; urn: string; picture?: string }>(people: T[], meId: string): T[] {
  return [...new Map(people.filter((p) => p.picture && p.id !== meId).map((p) => [p.urn, p])).values()];
}

/** Remembers when each person was last tried, so a picture that keeps failing is not asked for on every message. */
export class RecentTries {
  private readonly at = new Map<string, number>();
  constructor(private readonly ms = RETRY_MS, private readonly max = 5_000) {}

  /** True, and noted, when this key has not been tried within the wait. */
  try(key: string, now = Date.now()): boolean {
    const last = this.at.get(key);
    if (last !== undefined && now - last < this.ms) return false;
    if (this.at.size >= this.max) this.at.clear();
    this.at.set(key, now);
    return true;
  }
}

/** The picture's bytes, or null when it is not an image of a sensible size. Throws what the helper throws. */
export async function fetchPictureBytes(helper: Pick<Helper, "call">, url: string): Promise<Buffer | null> {
  const { data } = await helper.call("picture", { url });
  const bytes = Buffer.from(data, "base64");
  return bytes.length > 0 && bytes.length <= MAX_BYTES && imageType(bytes) ? bytes : null;
}
