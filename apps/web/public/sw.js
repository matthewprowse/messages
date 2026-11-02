// Konva's service worker. It does two things only: shows a push notification and opens the conversation when it is
// tapped. It has no fetch handler and no cache on purpose: every request goes straight to the network, so a page or an
// API response with someone's mail in it can never be stored or served from here.
//
// A push carries no names, addresses or message text (see apps/worker/src/push/payload.ts), only fixed words and the
// conversation id, so everything shown here is safe on a lock screen.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const threadId = typeof data.threadId === "string" && /^[0-9a-f-]{8,64}$/i.test(data.threadId) ? data.threadId : "";
  const title = typeof data.title === "string" && data.title ? data.title : "New Message";
  const body = typeof data.body === "string" && data.body ? data.body : "New message from a client.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
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
