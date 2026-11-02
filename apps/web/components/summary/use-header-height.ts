"use client";

// The Summary header's measured height, which the section bands stick under and the scrollbar starts below. It changes
// with the selection bar and the text size, so it is measured rather than assumed.

import { useLayoutEffect, useRef, useState } from "react";

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
