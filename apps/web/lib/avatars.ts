"use client";

import { useSignedUrl } from "./signed-urls";

/** A displayable link for a contact or group photo, or undefined while it loads or when there is none. */
export function useAvatarUrl(path: string | undefined): string | undefined {
  return useSignedUrl("avatars", path) ?? undefined;
}
