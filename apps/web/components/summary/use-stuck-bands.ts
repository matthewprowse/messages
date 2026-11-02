"use client";

// Marks a section band `data-stuck` once it has scrolled away from its place at the top of its section, so its
// separator shows only then. Re-checks when `deps` change, since they add or remove sections.

import { useEffect, type DependencyList, type RefObject } from "react";

export function useStuckBands(rowsRef: RefObject<HTMLElement | null>, deps: DependencyList) {
  useEffect(() => {
    const content = rowsRef.current;
    const viewport = content?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!content || !viewport) return;
    const update = () => {
      for (const band of content.querySelectorAll<HTMLElement>("[data-band]")) {
        const section = band.parentElement;
        if (!section) continue;
        // Where the band sits when nothing has moved it: the section's top, below the section's own padding.
        const home = section.getBoundingClientRect().top + parseFloat(getComputedStyle(section).paddingTop);
        band.toggleAttribute("data-stuck", band.getBoundingClientRect().top - home > 0.5);
      }
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const resized = new ResizeObserver(update);
    resized.observe(content);
    return () => {
      viewport.removeEventListener("scroll", update);
      resized.disconnect();
    };
  }, [rowsRef, ...deps]);
}
