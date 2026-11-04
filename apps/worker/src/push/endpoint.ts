// Which push subscription endpoints the worker will post to: only the browsers' own push services. A person writes
// their own endpoint row, so without this the sender would post (signed, on a schedule) to any address they chose.
// The same list is enforced by the push_subscriptions_endpoint_service check in the database; keep the two in step.

/**
 * Hosts of the push services browsers hand out: FCM (Chrome, Edge on Android, Opera, Brave, Samsung), Apple
 * (Safari), Mozilla autopush (Firefox) and WNS (Edge on Windows). A leading "." means any name under that domain.
 */
export const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", ".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"] as const;

const MAX_ENDPOINT_CHARS = 2048;

/** True when the endpoint is an https URL on port 443 of a known push service, with no credentials. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_CHARS) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((h) => (h.startsWith(".") ? host.endsWith(h) && host.length > h.length : host === h));
}
