"use client";

import { LOGO_AVATAR } from "./people";
import { useSignedUrl } from "./signed-urls";

/** A displayable link for a contact or group photo, or a company logo, or undefined while it loads or when there is none. */
export function useAvatarUrl(path: string | undefined): string | undefined {
  const logo = path?.startsWith(LOGO_AVATAR);
  return useSignedUrl(logo ? "logos" : "avatars", logo ? path!.slice(LOGO_AVATAR.length) : path) ?? undefined;
}
