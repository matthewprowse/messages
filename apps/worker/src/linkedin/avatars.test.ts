import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_FRESH_MS, RecentTries, fetchPictureBytes, photoDue, withPictures } from "./avatars";

const now = Date.parse("2026-11-01T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("a contact with no photo is due unless it was checked this week", () => {
  assert.equal(photoDue({ avatar_path: null, avatar_source: null, avatar_updated_at: null }, now), true);
  assert.equal(photoDue({ avatar_path: null, avatar_source: null, avatar_updated_at: ago(PHOTO_FRESH_MS + 1000) }, now), true);
  assert.equal(photoDue({ avatar_path: null, avatar_source: null, avatar_updated_at: ago(60_000) }, now), false);
});

test("a photo from an address book or WhatsApp is kept", () => {
  for (const source of ["icloud", "google", "whatsapp"]) {
    assert.equal(photoDue({ avatar_path: "u/c", avatar_source: source, avatar_updated_at: ago(30 * 24 * 3600_000) }, now), false);
  }
});

test("a LinkedIn photo is fetched again after a week", () => {
  assert.equal(photoDue({ avatar_path: "u/c", avatar_source: "linkedin", avatar_updated_at: ago(2 * 24 * 3600_000) }, now), false);
  assert.equal(photoDue({ avatar_path: "u/c", avatar_source: "linkedin", avatar_updated_at: ago(8 * 24 * 3600_000) }, now), true);
  assert.equal(photoDue({ avatar_path: "u/c", avatar_source: "linkedin", avatar_updated_at: null }, now), true);
});

test("an unknown contact is never due", () => {
  assert.equal(photoDue(undefined, now), false);
});

test("only other people with a picture are looked up, each once", () => {
  const people = [
    { id: "ME", urn: "urn:li:fsd_profile:ME", picture: "https://media.licdn.com/me" },
    { id: "A", urn: "urn:li:fsd_profile:A", picture: "https://media.licdn.com/a" },
    { id: "A", urn: "urn:li:fsd_profile:A", picture: "https://media.licdn.com/a2" },
    { id: "B", urn: "urn:li:fsd_profile:B" },
  ];
  assert.deepEqual(withPictures(people, "ME").map((p) => p.id), ["A"]);
});

test("a person is not tried again within the wait", () => {
  const tries = new RecentTries(1000);
  assert.equal(tries.try("a", 0), true);
  assert.equal(tries.try("a", 500), false);
  assert.equal(tries.try("b", 500), true);
  assert.equal(tries.try("a", 1500), true);
});

test("the picture comes from the helper and must be an image", async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const asked: unknown[] = [];
  const helper = (data: string) => ({
    call: (async (cmd: string, args: unknown) => {
      asked.push([cmd, args]);
      return { data, type: "image/png" };
    }) as never,
  });
  assert.deepEqual(await fetchPictureBytes(helper(png.toString("base64")), "https://media.licdn.com/x"), png);
  assert.deepEqual(asked, [["picture", { url: "https://media.licdn.com/x" }]]);
  assert.equal(await fetchPictureBytes(helper(Buffer.from("<html>").toString("base64")), "u"), null);
  assert.equal(await fetchPictureBytes(helper(""), "u"), null);
});
