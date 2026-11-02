// Tests for calendar/meeting-link.ts: which addresses count as a video call and how they are picked from a provider's
// own fields and from free text.

import assert from "node:assert/strict";
import test from "node:test";
import { findMeetingLink, isMeetingUrl, providerLink } from "./meeting-link";

test("only https addresses of known call services count", () => {
  assert.equal(isMeetingUrl("https://us02web.zoom.us/j/1"), true);
  assert.equal(isMeetingUrl("https://example.com/zoom.us/j/1"), false);
  assert.equal(isMeetingUrl("http://zoom.us/j/1"), false);
  assert.equal(isMeetingUrl(null), false);
});

test("a provider's own link beats one in the text", () => {
  assert.equal(findMeetingLink([null, "https://teams.microsoft.com/l/x"], ["https://zoom.us/j/1"]), "https://teams.microsoft.com/l/x");
});

test("the first link in the text is used and a closing full stop is dropped", () => {
  assert.equal(findMeetingLink([], ["Call me", "Join at https://meet.google.com/abc-defg-hij."]), "https://meet.google.com/abc-defg-hij");
  assert.equal(findMeetingLink([], [null, undefined]), null);
});

test("a provider's own link may be any https address", () => {
  assert.equal(providerLink(" https://whereby.com/room "), "https://whereby.com/room");
  assert.equal(providerLink("http://whereby.com/room"), null);
});
