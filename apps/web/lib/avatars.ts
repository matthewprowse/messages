"use client";

// Hooks that turn a stored contact, group or company-logo path into an image link: a signed link (signed-urls.ts) for a
// photo, and for a logo its public address, or a signed one while it is still in the private bucket (logo-paths.ts).

import { isPublicLogo, PRIVATE_LOGOS_BUCKET, PUBLIC_LOGOS_BUCKET } from "./logo-paths";
import { LOGO_AVATAR } from "./people";
import { useSignedUrl } from "./signed-urls";
import { supabase } from "./supabase";

/**
 * A company logo's link, or undefined while it loads or when there is none. A public logo's address is the same on
 * every launch and device and needs no request to make, so the browser's cache keeps the picture.
 */
export function useLogoUrl(path: string | undefined): string | undefined {
  const isPublic = !!path && isPublicLogo(path);
  const signed = useSignedUrl(PRIVATE_LOGOS_BUCKET, isPublic ? undefined : path) ?? undefined;
  return isPublic ? supabase.storage.from(PUBLIC_LOGOS_BUCKET).getPublicUrl(path).data.publicUrl : signed;
}

/** A displayable link for a contact or group photo, or a company logo, or undefined while it loads or when there is none. */
export function useAvatarUrl(path: string | undefined): string | undefined {
  // A path from the site root ("/demo/...") is an image the site serves itself: the marketing pages' made up people.
  // Stored paths never start with "/".
  const own = path?.startsWith("/");
  const logo = path?.startsWith(LOGO_AVATAR);
  const logoUrl = useLogoUrl(logo ? path!.slice(LOGO_AVATAR.length) : undefined);
  const signed = useSignedUrl("avatars", own || logo ? undefined : path) ?? undefined;
  return own ? path : logo ? logoUrl : signed;
}
