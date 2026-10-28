// Tests for profile-photo.ts: the storage path rule and the centre crop.

import { test } from "node:test";
import assert from "node:assert/strict";
import { centreCrop, isOwnPhotoPath, photoPathFor } from "./profile-photo";

test("the photo path is the user's id then me, and only that path is allowed", () => {
  assert.equal(photoPathFor("u1"), "u1/me");
  assert.ok(isOwnPhotoPath("u1", null));
  assert.ok(isOwnPhotoPath("u1", "u1/me"));
  assert.ok(!isOwnPhotoPath("u1", "u2/me"));
  assert.ok(!isOwnPhotoPath("u1", "u1/other"));
});

test("the crop is the centred square of the shorter side", () => {
  assert.deepEqual(centreCrop(1000, 600), { sx: 200, sy: 0, side: 600 });
  assert.deepEqual(centreCrop(600, 1000), { sx: 0, sy: 200, side: 600 });
  assert.deepEqual(centreCrop(500, 500), { sx: 0, sy: 0, side: 500 });
});
