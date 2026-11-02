// Tests for whatsapp/media-content.ts: media is found through the wrappers WhatsApp puts around it, and only to a bounded depth.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { proto } from "baileys";
import { mediaContent } from "./media-content";

const image = { mimetype: "image/jpeg" };

test("a plain image message gives its image part", () => {
  assert.equal(mediaContent({ imageMessage: image } as proto.IMessage, "imageMessage"), image);
});

test("a view once or disappearing wrapper is unwrapped, even nested", () => {
  const nested = { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: image } } } } } as proto.IMessage;
  assert.equal(mediaContent(nested, "imageMessage"), image);
});

test("a message with no media type, or without that part, gives nothing", () => {
  assert.equal(mediaContent({ imageMessage: image } as proto.IMessage, undefined), null);
  assert.equal(mediaContent({ conversation: "hi" } as proto.IMessage, "imageMessage"), undefined);
});
