// Google Contacts through the People API, read only. Needs the contacts.readonly scope, which older
// sign-ins do not have: without it this source is skipped until you run pnpm connect:google again.

import type { GoogleClient } from "../google/client";
import type { Card } from "./cards";

interface Person {
  names?: { displayName?: string; metadata?: { primary?: boolean } }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string; canonicalForm?: string }[];
  photos?: { url?: string; default?: boolean; metadata?: { primary?: boolean } }[];
}

/** Your Google contacts: their names, and photos of their own (not Google's generated initials). */
export async function googleCards(client: GoogleClient): Promise<Card[]> {
  const cards: Card[] = [];
  let pageToken: string | undefined;
  do {
    const page = await client.request<{ connections?: Person[]; nextPageToken?: string }>(
      "https://people.googleapis.com/v1/people/me/connections",
      { query: { personFields: "names,emailAddresses,phoneNumbers,photos", pageSize: 1000, pageToken } },
    );
    for (const p of page.connections ?? []) {
      const photo = p.photos?.find((ph) => ph.url && !ph.default && ph.metadata?.primary !== false) ?? p.photos?.find((ph) => ph.url && !ph.default);
      const name = (p.names?.find((n) => n.metadata?.primary) ?? p.names?.[0])?.displayName?.trim() || null;
      if (!photo?.url && !name) continue;
      cards.push({
        name,
        emails: (p.emailAddresses ?? []).map((e) => e.value?.trim().toLowerCase()).filter((e): e is string => !!e),
        phones: (p.phoneNumbers ?? []).map((n) => n.canonicalForm ?? n.value).filter((n): n is string => !!n),
        // Google's photo addresses take a size: ask for one big enough for a sharp avatar.
        photo: photo?.url ? { url: photo.url.replace(/=s\d+(-c)?$/, "") + "=s200-c" } : null,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return cards;
}

/** Google serves contact photos from its image hosts without a sign-in. Other hosts are not contacted. */
export async function fetchGooglePhoto(url: string): Promise<Buffer | null> {
  if (!/^https:\/\/[\w.-]+\.(googleusercontent|ggpht)\.com\//i.test(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
  return response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
}
