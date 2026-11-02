// Tests for send/cleanup-rules.ts: the cleanup never removes an object outside the user's own outbox folder.

import assert from "node:assert/strict";
import { test } from "node:test";
import { removableOutboxPath } from "./cleanup-rules";

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
