// Finds the video-call link of a calendar event, for the Join Meeting button. Shared by every calendar connector: a
// provider's own field (Meet's hangoutLink, Outlook's onlineMeeting, iCloud's CONFERENCE) is trusted first, and
// otherwise the first Zoom, Meet, Teams or Webex address in the notes or location is used, because most Zoom and
// Teams invitations only put the link in the text. Pure.

const MEETING_LINK = /https:\/\/(?:[\w-]+\.)?(?:zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com)\/[^\s<>"')]+/i;

/** True for an https address of a known video-call service. */
export function isMeetingUrl(url: string | null | undefined): url is string {
  return !!url && /^https:\/\//i.test(url.trim()) && MEETING_LINK.test(url);
}

/**
 * The event's own links (a provider field, in order of trust) if one is a known meeting address, else the first
 * meeting address found in `texts` (notes, location, body). Only https links; the full stop or comma a sentence puts
 * after a link is dropped.
 */
export function findMeetingLink(own: (string | null | undefined)[], texts: (string | null | undefined)[]): string | null {
  const direct = own.find(isMeetingUrl);
  if (direct) return direct.trim();
  const found = MEETING_LINK.exec(texts.map((t) => t ?? "").join("\n"))?.[0];
  return found ? found.replace(/[.,;]+$/, "") : null;
}

/**
 * A provider's own video link, any https address: a Google event can carry a Whereby or Jitsi entry point that is not
 * one of the known services, and the provider says it is the call.
 */
export function providerLink(link: string | null | undefined): string | null {
  return link && /^https:\/\//i.test(link.trim()) ? link.trim() : null;
}
