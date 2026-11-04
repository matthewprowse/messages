// The service worker's rules (public/sw.js loads this with importScripts): which requests it may answer from its cache,
// under which key, and when a stored copy is too old or too many. Pure: no caches, no fetch, so lib/sw-rules.test.ts
// runs it in node exactly as the service worker does. It is a plain script, not a module, because Safari's service
// workers cannot import modules; it puts one frozen object on globalThis.konvaSw.

(() => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Bump VERSION when the stored format or the rules change: activating a new version deletes every older cache.
  const VERSION = "v1";

  // The signed-in app's sections. Their documents are a shell with no user data (the AppShell renders an empty frame
  // until the browser has a session; every screen loads its data from Supabase in the browser).
  const APP_SECTIONS = ["inbox", "summary", "calendar", "contacts", "notes", "attachments", "settings"];

  // A sign-in provider returns here with a code in the URL (attachments/onedrive-callback): always the network.
  const CALLBACK_SEGMENT = /(^|\/)[^/]*callback(\/|$)/i;

  const LIMITS = {
    // Past this a stored page is not shown; the network is awaited instead, so a long absence never boots old code.
    pageMaxAgeMs: 3 * DAY_MS,
    // An expired page is still kept this long, only to open the app when the network is down.
    pageKeepMs: 14 * DAY_MS,
    // How long a navigation waits for a background fetch of the same page that is already running.
    pendingWaitMs: 3000,
    pageMaxEntries: 40,
    // Code not used for this long is dropped, unless a stored page still needs it.
    staticMaxAgeMs: 30 * DAY_MS,
    staticMaxEntries: 600,
    // A file served from the cache is stamped again at most this often, so pruning goes by last use, not first.
    staticTouchMs: DAY_MS,
    // Pruning reads every entry, so it runs at most this often (and on activate).
    pruneEveryMs: 10 * 60 * 1000,
  };

  /** The page key for a URL: its path with no trailing slash, or null when the path is not a cached app route. */
  function pageKey(url) {
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    const section = path.split("/")[1];
    if (!APP_SECTIONS.includes(section) || CALLBACK_SEGMENT.test(path)) return null;
    return path;
  }

  /**
   * How to answer a request: "page" (stale while revalidate), "static" (cache first) or null (straight to the network).
   * `req` is { url: URL, method, mode, headers: Headers }; `origin` is the service worker's own.
   */
  function requestKind(req, origin) {
    if (req.method !== "GET" || req.url.origin !== origin) return null;
    // Soft navigations and prefetches fetch the RSC payload for the same address; it is not a page and is never kept.
    const h = req.headers;
    if (h.has("rsc") || h.has("next-router-prefetch") || h.has("next-router-state-tree") || h.get("purpose") === "prefetch" || req.url.searchParams.has("_rsc")) return null;
    if (h.has("range")) return null;
    if (req.url.pathname.startsWith("/_next/static/")) return "static";
    if (req.mode === "navigate" && pageKey(req.url)) return "page";
    return null;
  }

  /** True when a response may be stored: a plain same-origin 200, not a redirect, and HTML for a page. */
  function isStorable(res, kind) {
    if (!res || res.status !== 200 || res.type !== "basic" || res.redirected) return false;
    if (kind === "page") return (res.headers.get("content-type") || "").startsWith("text/html");
    return true;
  }

  /** True when a page stored at `storedAt` (ms) may still be shown at `now`. */
  function isPageFresh(storedAt, now) {
    return Number.isFinite(storedAt) && now - storedAt >= 0 && now - storedAt < LIMITS.pageMaxAgeMs;
  }

  // Script, style and font addresses in a page: the tags (/_next/static/...) and the RSC payload's client chunk list,
  // where they appear as static/chunks/... inside an escaped string. No lookbehind: older Safari cannot parse it, and
  // a syntax error here would stop the whole service worker (push included) from installing.
  const ASSET_TAG = /\/_next\/static\/[^"'\\\s<>()&]+/g;
  const ASSET_FLIGHT = /["\\\s,[](static\/(?:chunks|css|media)\/[^"'\\\s<>()&]+)/g;

  /** Every /_next/static path a page's HTML loads, once each, so the page is kept together with its code. */
  function assetPaths(html) {
    const out = new Set();
    for (const m of html.match(ASSET_TAG) || []) out.add(m);
    for (const m of html.matchAll(ASSET_FLIGHT)) out.add(`/_next/${m[1]}`);
    return [...out];
  }

  /** The Next build id in a page's RSC payload ("b":"..."), or null when it cannot be found. */
  function buildIdOf(html) {
    const m = /\\?"b\\?":\\?"([A-Za-z0-9_-]{4,64})\\?"/.exec(html);
    return m ? m[1] : null;
  }

  /**
   * Which entries to delete: those older than `maxAgeMs`, then the oldest past `maxEntries`. Keys in `keep` stay
   * whatever their age. `entries` is [{ key, storedAt }] with storedAt in ms (NaN for an unreadable entry).
   */
  function keysToPrune(entries, now, maxAgeMs, maxEntries, keep) {
    const drop = new Set();
    const live = [];
    for (const e of entries) {
      if (keep && keep.has(e.key)) continue;
      if (!Number.isFinite(e.storedAt) || now - e.storedAt > maxAgeMs) drop.add(e.key);
      else live.push(e);
    }
    const kept = entries.length - drop.size;
    if (kept > maxEntries) {
      live.sort((a, b) => a.storedAt - b.storedAt);
      for (const e of live.slice(0, kept - maxEntries)) drop.add(e.key);
    }
    return [...drop];
  }

  globalThis.konvaSw = Object.freeze({
    VERSION,
    PAGE_CACHE: `konva-pages-${VERSION}`,
    STATIC_CACHE: `konva-static-${VERSION}`,
    CACHE_PREFIX: "konva-",
    STORED_AT_HEADER: "x-konva-stored-at",
    BUILD_HEADER: "x-konva-build",
    // What the page posts (lib/service-worker.ts mirrors these; the test checks they match).
    MESSAGES: Object.freeze({ clearPages: "konva:clear-pages", warmPage: "konva:warm-page" }),
    LIMITS: Object.freeze(LIMITS),
    APP_SECTIONS: Object.freeze(APP_SECTIONS),
    pageKey,
    requestKind,
    isStorable,
    isPageFresh,
    assetPaths,
    buildIdOf,
    keysToPrune,
  });
})();
