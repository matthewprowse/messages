// Konva's service worker: push notifications, and a copy of the app page and its code so the app opens at once.
//
// It caches the app page and code only, never data. Kept: the HTML document of a signed-in app route (/inbox,
// /summary, /calendar, /contacts, /notes, /attachments, /settings and below), which is an empty frame until the browser
// has a session, and the content-hashed files under /_next/static. Never kept: /api, sign-in and auth callbacks, /login,
// the marketing pages, RSC and prefetch fetches, anything that is not a GET, anything cross-origin (Supabase, so no mail,
// names or files), media, and any response that is not a plain 200 from this site. The rules live in sw-rules.js.
//
// A push carries no names, addresses or message text (see apps/worker/src/push/payload.ts), only fixed words and the
// conversation id, so everything shown here is safe on a lock screen.

importScripts("/sw-rules.js");
const R = self.konvaSw;

// The app's pages are keyed by path alone, not by section: Next renders the page tree of the address it served, so the
// /inbox document shown at /inbox/<id> would show the empty Inbox (and seed the router with the wrong tree).
// Stored pages are dropped on sign-out; `generation` stops a fetch that was already running from storing one after.
let generation = 0;
const revalidating = new Map(); // page key -> promise of the background fetch
let lastPrune = 0;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  // A new version's rules may not suit what an older one stored, so its caches go.
  const mine = [R.PAGE_CACHE, R.STATIC_CACHE];
  for (const name of await caches.keys()) if (name.startsWith(R.CACHE_PREFIX) && !mine.includes(name)) await caches.delete(name);
  await self.clients.claim();
  await prune(true);
})()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const kind = R.requestKind({ url, method: req.method, mode: req.mode, headers: req.headers }, self.location.origin);
  if (kind === "page") event.respondWith(servePage(event, new URL(R.pageKey(url), url.origin).href));
  else if (kind === "static") event.respondWith(serveStatic(event, url));
  // Everything else is not answered here, so the browser fetches it as if there were no service worker.
});

// Stale while revalidate. The stored Response keeps its own headers, Content-Security-Policy included: the nonce in that
// header is the one middleware.ts put on that document's scripts, so the copy and its policy always match. A fresh
// nonce on an old document (or the reverse) would block every script on the page.
async function servePage(event, key) {
  const req = event.request;
  const cache = await caches.open(R.PAGE_CACHE);
  // A background fetch for this page is already running (a fresh build makes Next reload the page): wait for it,
  // so the reload gets the new document rather than the old one again. Not for long on a slow connection, though.
  const pending = revalidating.get(key);
  if (pending) await Promise.race([pending, new Promise((done) => setTimeout(done, R.LIMITS.pendingWaitMs))]);
  const cached = await cache.match(key, { ignoreVary: true });
  // A reload asks for the newest page; so does a copy past its max age.
  const wantsFresh = req.cache === "reload" || req.cache === "no-cache";
  if (cached && !wantsFresh && R.isPageFresh(Number(cached.headers.get(R.STORED_AT_HEADER)), Date.now())) {
    if (!pending) event.waitUntil(revalidate(key));
    return cached;
  }
  try {
    const res = await fetch(req);
    // Only the bare path is stored: a copy fetched with ?query would carry that query in its page tree.
    if (R.isStorable(res, "page")) event.waitUntil(new URL(req.url).search ? revalidate(key) : storePage(key, res.clone(), generation).catch(() => undefined));
    return res;
  } catch (err) {
    // Offline: an old copy still opens the app (its code is kept with it); the screens show their own offline state.
    if (cached) return cached;
    throw err;
  }
}

/** Fetches a page in the background and stores it. One at a time per page. */
function revalidate(key) {
  if (revalidating.has(key)) return revalidating.get(key);
  const gen = generation;
  const run = (async () => {
    try {
      const res = await fetch(key, { headers: { accept: "text/html" }, cache: "no-store", credentials: "same-origin" });
      if (R.isStorable(res, "page")) return await storePage(key, res, gen);
      // The route is gone or now redirects (a deploy moved it): forget it. A server error keeps the old copy.
      if (res.status < 500) await (await caches.open(R.PAGE_CACHE)).delete(key);
    } catch {
      // Offline or the server is slow to answer: keep what is stored.
    }
  })().finally(() => revalidating.delete(key));
  revalidating.set(key, run);
  return run;
}

/** Stores a page only once every script, style and font it loads is in the static cache, so it can always start. */
async function storePage(key, res, gen) {
  const html = await res.text();
  await Promise.all(R.assetPaths(html).map((path) => cacheStatic(new URL(path, self.location.origin).href)));
  const headers = new Headers(res.headers);
  // The body is stored decoded, so its old encoding and length no longer describe it.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set(R.STORED_AT_HEADER, String(Date.now()));
  const build = R.buildIdOf(html);
  if (build) headers.set(R.BUILD_HEADER, build);
  const cache = await caches.open(R.PAGE_CACHE);
  if (gen !== generation) return;
  await cache.put(key, new Response(html, { status: 200, statusText: res.statusText, headers }));
  // A page from a new build makes every page from an older one useless: drop them now, so the reload Next does on
  // a build change never lands on an old copy of another section.
  if (build) {
    for (const other of await cache.keys()) {
      const stored = await cache.match(other);
      const was = stored && stored.headers.get(R.BUILD_HEADER);
      if (was && was !== build) await cache.delete(other);
    }
  }
  await prune(false);
}

// Cache first: a /_next/static address names its content, so a stored copy is never out of date. Keeping them here
// also keeps the code a stored page needs after a deploy has taken it off the server.
async function serveStatic(event, url) {
  const cache = await caches.open(R.STATIC_CACHE);
  const hit = await cache.match(url.href, { ignoreVary: true });
  if (hit) {
    const storedAt = Number(hit.headers.get(R.STORED_AT_HEADER));
    if (!(Date.now() - storedAt < R.LIMITS.staticTouchMs)) event.waitUntil(putStatic(cache, url.href, hit.clone()).catch(() => undefined));
    return hit;
  }
  const res = await fetch(event.request);
  if (R.isStorable(res, "static")) event.waitUntil(putStatic(cache, url.href, res.clone()).catch(() => undefined));
  return res;
}

/** Fetches one static file into the cache unless it is there. Throws when it cannot, so the page is not stored. */
async function cacheStatic(href) {
  const cache = await caches.open(R.STATIC_CACHE);
  if (await cache.match(href, { ignoreVary: true })) return;
  const res = await fetch(href, { credentials: "same-origin" });
  if (!R.isStorable(res, "static")) throw new Error(`static ${res.status}`);
  await putStatic(cache, href, res);
}

async function putStatic(cache, href, res) {
  const headers = new Headers(res.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set(R.STORED_AT_HEADER, String(Date.now()));
  await cache.put(href, new Response(await res.arrayBuffer(), { status: 200, statusText: res.statusText, headers }));
}

/** Bounds both caches. The code a stored page loads is never pruned while that page is kept. */
async function prune(force) {
  const now = Date.now();
  if (!force && now - lastPrune < R.LIMITS.pruneEveryMs) return;
  lastPrune = now;
  const pages = await caches.open(R.PAGE_CACHE);
  const pageEntries = await readEntries(pages);
  for (const key of R.keysToPrune(pageEntries, now, R.LIMITS.pageKeepMs, R.LIMITS.pageMaxEntries)) await pages.delete(key);
  const keep = new Set();
  for (const req of await pages.keys()) {
    const res = await pages.match(req);
    if (res) for (const path of R.assetPaths(await res.text())) keep.add(new URL(path, self.location.origin).href);
  }
  const statics = await caches.open(R.STATIC_CACHE);
  for (const key of R.keysToPrune(await readEntries(statics), now, R.LIMITS.staticMaxAgeMs, R.LIMITS.staticMaxEntries, keep)) await statics.delete(key);
}

async function readEntries(cache) {
  const out = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    out.push({ key: req.url, storedAt: Number(res && res.headers.get(R.STORED_AT_HEADER)) });
  }
  return out;
}

// The page asks for its stored pages to go (sign-out), or for the page it opened on to be stored the first time.
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === R.MESSAGES.clearPages) {
    generation++;
    event.waitUntil(caches.delete(R.PAGE_CACHE));
  } else if (msg.type === R.MESSAGES.warmPage && typeof msg.path === "string") {
    const url = new URL(msg.path, self.location.origin);
    const key = url.origin === self.location.origin && R.pageKey(url);
    if (!key) return;
    const href = new URL(key, url.origin).href;
    event.waitUntil(caches.open(R.PAGE_CACHE).then((c) => c.match(href)).then((hit) => hit ? undefined : revalidate(href)));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const threadId = typeof data.threadId === "string" && /^[0-9a-f-]{8,64}$/i.test(data.threadId) ? data.threadId : "";
  const title = typeof data.title === "string" && data.title ? data.title : "New Message";
  const body = typeof data.body === "string" && data.body ? data.body : "New message from a client.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    // ?v=2 matches the manifest: the icons are served with a year's immutable cache, so the address names the version.
    icon: "/icon-192.png?v=2",
    badge: "/icon-192.png?v=2",
    // One notification per conversation: a newer message replaces the older one rather than stacking.
    tag: threadId || "konva",
    renotify: true,
    data: { url: threadId ? `/inbox/${threadId}` : "/inbox" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/inbox", self.location.origin);
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Reuse a window that is already open on Konva: focus it and move it to the conversation.
    for (const client of open) {
      if (new URL(client.url).origin !== target.origin) continue;
      await client.focus();
      if ("navigate" in client) await client.navigate(target.href).catch(() => undefined);
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
