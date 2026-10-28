// Tests for gmailUploadRequest in google/gmail-upload.ts: a new email is a media upload, a reply is a multipart upload carrying the conversation ID.

import { test } from "node:test";
import assert from "node:assert/strict";
import { gmailUploadRequest } from "./gmail-upload";

const raw = Buffer.from("From: a@example.com\r\nSubject: Hi\r\n\r\nHello\r\n");

test("a new email uploads its bytes as they are", () => {
  const { uploadType, body } = gmailUploadRequest(raw);
  assert.equal(uploadType, "media");
  assert.equal(body.contentType, "message/rfc822");
  assert.ok(body.data.equals(raw));
});

test("a reply uploads the conversation ID and the bytes together", () => {
  const { uploadType, body } = gmailUploadRequest(raw, "18c2f0a1b2c3d4e5");
  assert.equal(uploadType, "multipart");
  const boundary = /^multipart\/related; boundary=(\S+)$/.exec(body.contentType)?.[1];
  assert.ok(boundary);
  const text = body.data.toString();
  const parts = text.split(`--${boundary}`);
  assert.equal(parts.length, 4); // before, metadata, email, closing
  assert.equal(parts[0], "");
  assert.equal(parts[1], `\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"threadId":"18c2f0a1b2c3d4e5"}\r\n`);
  assert.equal(parts[2], `\r\nContent-Type: message/rfc822\r\n\r\n${raw.toString()}\r\n`);
  assert.equal(parts[3], "--\r\n");
});
