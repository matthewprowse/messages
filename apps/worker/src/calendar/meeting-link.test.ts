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

test("a call service named anywhere but the host does not count", () => {
  for (const bad of [
    "https://evil.example/?u=https://zoom.us/j/1",
    "https://evil.example/#https://meet.google.com/abc",
    "https://zoom.us.evil.example/j/1",
    "https://evilzoom.us/j/1",
    "https://zoom.us@evil.example/j/1",
    "https://user:pw@zoom.us/j/1",
    "https://zoom.us/",
    "not a url",
  ]) assert.equal(isMeetingUrl(bad), false, bad);
  for (const good of ["https://zoom.us/j/1", "https://a.b.zoom.us/j/1", "https://MEET.google.com/abc-defg-hij", "https://teams.live.com/meet/1", "https://acme.webex.com/meet/x"]) {
    assert.equal(isMeetingUrl(good), true, good);
  }
});

test("a disguised link in the text is skipped for a real one after it", () => {
  assert.equal(findMeetingLink([], ["See https://evil.example/?u=https://zoom.us/j/1 or https://zoom.us/j/2."]), "https://zoom.us/j/2");
  assert.equal(findMeetingLink(["https://evil.example/?u=https://zoom.us/j/1"], ["nothing"]), null);
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
