"use client";

// Tells a tile or sentinel when it has come near the visible area, so links are asked for and images downloaded only for
// what is about to be seen. One IntersectionObserver is shared by everything.

import { useEffect, useState, type RefObject } from "react";

// One observer shared by every tile, rather than one each, for grids of hundreds of files.
const seenCallbacks = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function whenSeen(el: Element, callback: () => void) {
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seenCallbacks.get(e.target)?.();
      seenCallbacks.delete(e.target);
      observer?.unobserve(e.target);
    }
  }, { rootMargin: "800px" });
  seenCallbacks.set(el, callback);
  observer.observe(el);
  return () => {
    seenCallbacks.delete(el);
    observer?.unobserve(el);
  };
}

/** True once the element has come near the visible area. Never goes back to false. */
export function useSeen(ref: RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    return whenSeen(el, () => setSeen(true));
  }, [ref, seen]);
  return seen;
}
