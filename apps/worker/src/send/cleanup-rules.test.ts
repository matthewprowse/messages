// Tests for send/cleanup-rules.ts: the cleanup never removes an object outside the user's own outbox folder, and each
// kind of outbox file has its own keep time.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FAILED_KEEP_MS, outboxCleanupCutoffs, outboxOwner, removableOutboxPath, SENT_KEEP_MS, STUCK_KEEP_MS } from "./cleanup-rules";

const user = "11111111-1111-1111-1111-111111111111";
const item = "22222222-2222-2222-2222-222222222222";

test("a file in the user's own outbox folder may be removed", () => {
  assert.equal(removableOutboxPath(user, `${user}/outbox/${item}/photo 1.jpg`), true);
});

test("other users, other folders and traversal may not", () => {
  assert.equal(removableOutboxPath(user, `${item}/outbox/${item}/a.jpg`), false);
  assert.equal(removableOutboxPath(user, `${user}/files/${item}/a.jpg`), false);
  assert.equal(removableOutboxPath(user, `${user}/outbox/${item}/../../x.jpg`), false);
  assert.equal(removableOutboxPath(user, `${user}/outbox/${item}/a/b.jpg`), false);
  assert.equal(removableOutboxPath("not-a-uuid", "not-a-uuid/outbox/x/a.jpg"), false);
});

test("a sealed upload's path is removable like an old named one", () => {
  assert.equal(removableOutboxPath(user, `${user}/outbox/${item}/file`), true);
});

test("an orphaned object's owner is read from its path, and only from an outbox path", () => {
  assert.equal(outboxOwner(`${user}/outbox/${item}/file`), user);
  assert.equal(outboxOwner(`${user}/notes/${item}/file`), null);
  assert.equal(outboxOwner(`not-a-uuid/outbox/${item}/file`), null);
  assert.equal(outboxOwner("outbox"), null);
});

test("sent and failed files go after a day, stuck and orphaned ones after a week", () => {
  const now = Date.parse("2026-11-25T12:00:00.000Z");
  assert.deepEqual(outboxCleanupCutoffs(now), {
    sent: "2026-11-24T12:00:00.000Z",
    failed: "2026-11-24T12:00:00.000Z",
    stuck: "2026-11-18T12:00:00.000Z",
  });
  assert.ok(SENT_KEEP_MS <= FAILED_KEEP_MS && FAILED_KEEP_MS < STUCK_KEEP_MS);
});
