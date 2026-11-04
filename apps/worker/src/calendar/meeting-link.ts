// Finds the video-call link of a calendar event, for the Join Meeting button. Shared by every calendar connector: a
// provider's own field (Meet's hangoutLink, Outlook's onlineMeeting, iCloud's CONFERENCE) is trusted first, and
// otherwise the first Zoom, Meet, Teams or Webex address in the notes or location is used, because most Zoom and
// Teams invitations only put the link in the text. Pure.

// Call services by host name: the host itself or any subdomain of it (us02web.zoom.us). Matched on the parsed host,
// never on the text, so "https://evil.example/?u=https://zoom.us/j/1" is not a meeting.
const MEETING_HOSTS = ["zoom.us", "zoom.com", "zoomgov.com", "meet.google.com", "teams.microsoft.com", "teams.live.com", "webex.com"];
const HTTPS_LINK = /https:\/\/[^\s<>"')]+/gi;

/** True for an https address of a known video-call service, with a path (a bare home page is not a call). */
export function isMeetingUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname.length < 2) return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * The event's own links (a provider field, in order of trust) if one is a known meeting address, else the first
 * meeting address found in `texts` (notes, location, body). Only https links; the full stop or comma a sentence puts
 * after a link is dropped.
 */
export function findMeetingLink(own: (string | null | undefined)[], texts: (string | null | undefined)[]): string | null {
  const direct = own.find(isMeetingUrl);
  if (direct) return direct.trim();
  for (const match of texts.map((t) => t ?? "").join("\n").matchAll(HTTPS_LINK)) {
    const link = match[0].replace(/[.,;]+$/, "");
    if (isMeetingUrl(link)) return link;
  }
  return null;
}

/**
 * A provider's own video link, any https address: a Google event can carry a Whereby or Jitsi entry point that is not
 * one of the known services, and the provider says it is the call.
 */
export function providerLink(link: string | null | undefined): string | null {
  return link && /^https:\/\//i.test(link.trim()) ? link.trim() : null;
}
