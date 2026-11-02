"use client";

// The Summary header's and a section band's measured heights. The bands stick under the header and the scrollbar starts
// below both, so they are measured rather than assumed: they change with the selection bar and the text size.

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export function useHeaderHeight() {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(105);
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => setHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(header);
    return () => resized.disconnect();
  }, []);
  return { headerRef, headerHeight };
}

/** The height of the first section band under `rowsRef` (they are all alike). `key` changes when sections come or go, so a band that was not there at first is found. */
export function useBandHeight(rowsRef: RefObject<HTMLElement | null>, key: string) {
  const [height, setHeight] = useState(57); // p-3 around an h-8 title, plus the 1px border
  useLayoutEffect(() => {
    const band = rowsRef.current?.querySelector<HTMLElement>("[data-band]");
    if (!band) return;
    const measure = () => setHeight(band.getBoundingClientRect().height);
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(band);
    return () => resized.disconnect();
  }, [rowsRef, key]);
  return height;
}
