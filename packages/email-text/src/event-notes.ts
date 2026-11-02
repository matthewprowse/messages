// Turns an event's notes into plain text. Google sends notes as HTML (<br>, <a href>, <b>) from Meet, Zoom and Teams
// add-ons, and a note typed in an app arrives as plain text; both must read the same and neither may carry markup into
// the page. Used by the worker when it stores an event and by the web app for rows stored before that.

import { htmlToText } from "./index";

/** Tags that only HTML notes have. A plain note that mentions "<name>" is not mistaken for HTML. */
const MARKUP = /<\/?(?:br|p|div|a|b|i|u|em|strong|span|ul|ol|li|h[1-6]|table|tr|td|font|img|hr)(?:\s[^>]*)?\/?>|&(?:nbsp|amp|lt|gt|quot|#\d+);/i;

/**
 * The notes as plain text, trimmed and cut to `max` characters (the cut is made after the markup is gone, so it cannot
 * split a tag). Null when nothing is left. Links keep their address.
 */
export function eventNotes(raw: string | null | undefined, max = 5000): string | null {
  if (!raw) return null;
  const text = (MARKUP.test(raw) ? htmlToText(raw) : raw.replace(/\r\n?/g, "\n")).trim();
  return text ? text.slice(0, max) : null;
}
