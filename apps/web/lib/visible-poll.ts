// A poll that only runs while the tab is showing, and once more the moment it is shown again, so a hidden tab costs nothing.

/** Runs fn every ms while the page is visible, and when it becomes visible again. Returns the function that stops it. */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const timer = setInterval(() => { if (document.visibilityState === "visible") fn(); }, ms);
  const shown = () => { if (document.visibilityState === "visible") fn(); };
  document.addEventListener("visibilitychange", shown);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", shown);
  };
}
