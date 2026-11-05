// Tests for ingest/ingest-meta.ts: only what the headers gave is stored, and a move that rebuilds provider_meta keeps
// the verdicts and the Reply-To domain without bringing back anything else.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestMeta, keepIngestMeta } from "./ingest-meta";

test("the ingest keys are set only when the headers gave them", () => {
  assert.deepEqual(ingestMeta({ auth: null, replyToDomain: null, nameMismatch: false }), {});
  assert.deepEqual(ingestMeta({ auth: { dmarc: "fail" }, replyToDomain: "evil.biz", nameMismatch: false }), { auth: { dmarc: "fail" }, reply_to_domain: "evil.biz" });
  assert.deepEqual(ingestMeta({ auth: null, replyToDomain: null, nameMismatch: true }), { name_mismatch: true });
});

test("a rebuilt provider_meta keeps the ingest keys and nothing else of the old one", () => {
  const stored = { folder: "INBOX", uid: 4, uid_validity: 9, from: "Junk", auth: { spf: "pass" }, reply_to_domain: "evil.biz" };
  assert.deepEqual(keepIngestMeta(stored, { folder: "Archive", uid: 7, uid_validity: 9 }), { auth: { spf: "pass" }, reply_to_domain: "evil.biz", folder: "Archive", uid: 7, uid_validity: 9 });
  assert.deepEqual(keepIngestMeta({ folder: "INBOX" }, { left: "INBOX" }), { left: "INBOX" });
  assert.deepEqual(keepIngestMeta(null, { left: "INBOX" }), { left: "INBOX" });
});
