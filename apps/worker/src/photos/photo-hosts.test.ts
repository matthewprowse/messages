// Tests for photos/photo-hosts.ts: the iCloud sign-in only goes to iCloud's contacts hosts, and photo links on any
// other host, scheme, port or with credentials are refused.

import test from "node:test";
import assert from "node:assert/strict";
import { icloudContactsUrl, isGooglePhotoUrl, isICloudContactsUrl } from "./photo-hosts";

test("iCloud's contacts hosts are accepted, with hrefs resolved against the base", () => {
  assert.equal(isICloudContactsUrl("https://p1-contacts.icloud.com/p.jpg"), true);
  assert.equal(isICloudContactsUrl("https://contacts.icloud.com/"), true);
  assert.equal(icloudContactsUrl("/123/carddavhome/", "https://contacts.icloud.com/"), "https://contacts.icloud.com/123/carddavhome/");
  assert.equal(icloudContactsUrl("https://p48-contacts.icloud.com:443/1/carddavhome/", "https://contacts.icloud.com/"), "https://p48-contacts.icloud.com/1/carddavhome/");
});

test("any other iCloud or outside host is refused, so the sign-in never goes there", () => {
  for (const href of [
    "https://evil.icloud.com/p.jpg",
    "https://www.icloud.com/p.jpg",
    "https://p1-contacts.icloud.com.evil.com/p.jpg",
    "http://p1-contacts.icloud.com/p.jpg",
    "https://p1-contacts.icloud.com:8443/p.jpg",
    "https://a:b@p1-contacts.icloud.com/p.jpg",
    "https://example.com/p.jpg",
  ]) assert.equal(isICloudContactsUrl(href), false, href);
  assert.throws(() => icloudContactsUrl("https://example.com/book/", "https://contacts.icloud.com/"), { code: "BAD_HOST" });
  assert.throws(() => icloudContactsUrl("//evil.icloud.com/book/", "https://contacts.icloud.com/"), { code: "BAD_HOST" });
});

test("Google photo links are accepted only on Google's image hosts", () => {
  assert.equal(isGooglePhotoUrl("https://lh3.googleusercontent.com/a/x=s200-c"), true);
  assert.equal(isGooglePhotoUrl("https://lh3.ggpht.com/x"), true);
  assert.equal(isGooglePhotoUrl("https://googleusercontent.com.evil.com/x"), false);
  assert.equal(isGooglePhotoUrl("http://lh3.googleusercontent.com/x"), false);
  assert.equal(isGooglePhotoUrl("https://lh3.googleusercontent.com:444/x"), false);
});
