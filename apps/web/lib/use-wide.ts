"use client";

// Whether the screen is at the md breakpoint or wider, where lists and the open item sit side by side. Shared by the
// calendar and by the split layouts, which skip mounting a pane a phone never shows.

import { useSyncExternalStore } from "react";

/** The md breakpoint, matching Tailwind's md: prefix. */
export const WIDE = "(min-width: 768px)";

/**
 * True from the md breakpoint up. The server snapshot is true, so a desktop render never flashes the phone layout;
 * signed-in pages mount after the session check on the client, where the real value is read from the first render.
 */
export function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}
