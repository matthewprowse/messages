"use client";

// Hook that turns a stored contact, group or company-logo path into a signed image link (signed-urls.ts).

import { LOGO_AVATAR } from "./people";
import { useSignedUrl } from "./signed-urls";

/** A displayable link for a contact or group photo, or a company logo, or undefined while it loads or when there is none. */
export function useAvatarUrl(path: string | undefined): string | undefined {
  // A path from the site root ("/demo/...") is an image the site serves itself: the marketing pages' made up people.
  // Stored paths never start with "/".
  const own = path?.startsWith("/");
  const logo = path?.startsWith(LOGO_AVATAR);
  const signed = useSignedUrl(logo ? "logos" : "avatars", own ? undefined : logo ? path!.slice(LOGO_AVATAR.length) : path) ?? undefined;
  return own ? path : signed;
}
