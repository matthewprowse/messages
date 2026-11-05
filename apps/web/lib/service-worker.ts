// The page's side of the service worker (public/sw.js): registering it, asking it to store the page it opened on, and
// telling it to drop its stored pages on sign-out. The worker keeps the app page and code only, never data.

/** Message types sw.js understands. Mirrors MESSAGES in public/sw-rules.js; lib/sw-rules.test.ts checks they match. */
export const SW_MESSAGES = { clearPages: "konva:clear-pages", warmPage: "konva:warm-page" } as const;

const supported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator;

// The dev server's chunks change under the same names, so there the worker only does push (see public/sw.js).
const SCRIPT = process.env.NODE_ENV === "development" ? "/sw.js?dev=1" : "/sw.js";

/** Registers the service worker once (later calls return the same registration). Resolves null where unsupported. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return Promise.resolve(null);
  return navigator.serviceWorker.register(SCRIPT, { scope: "/" }).catch(() => null);
}

/** Posts to the active worker, once there is one. Failures are ignored: the worker is a speed-up, not a dependency. */
function post(message: Record<string, unknown>) {
  if (!supported()) return;
  navigator.serviceWorker.controller?.postMessage(message);
  // The first visit has no controller yet; ready resolves once the newly installed worker is active.
  void navigator.serviceWorker.ready.then((reg) => { if (reg.active !== navigator.serviceWorker.controller) reg.active?.postMessage(message); }).catch(() => undefined);
}

/** Registers the worker and asks it to store the page this tab opened on, so the next launch starts from the cache. */
export function startServiceWorker() {
  void registerServiceWorker().then((reg) => { if (reg) post({ type: SW_MESSAGES.warmPage, path: location.pathname }); });
}

/** Drops the worker's stored app pages. They hold no data, but a signed-out device keeps nothing of the app. */
export function clearCachedPages() {
  post({ type: SW_MESSAGES.clearPages });
}
