// The width of the calendar's grid pane, kept current as the window or the split changes, so the week view can show
// as many days as fit. Zero until the pane has been measured.

import { useLayoutEffect, useRef, useState } from "react";

export function usePaneWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
