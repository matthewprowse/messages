// The attachment viewer's stored file (stored-file.ts): a released blob link is never handed out on reopen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { releasedFile, shownFile, type HeldFile } from "./stored-file";

const SEALED: HeldFile = { id: "a", state: "ready", path: "p", view: "blob:x", download: "blob:x", sealed: true };
const SIGNED: HeldFile = { id: "a", state: "ready", path: "p", view: "https://x", download: "https://x", sealed: false };

test("a held blob link is shown", () => {
  assert.equal(shownFile(SEALED, "a", true), SEALED);
});

test("a released blob link stays while closing but is not handed out on reopen", () => {
  const released = releasedFile(SEALED);
  assert.equal(shownFile(released, "a", false)?.state, "ready");
  assert.deepEqual(shownFile(released, "a", true), { id: "a", state: "loading" });
});

test("a signed link is kept on release, so reopening does not flicker", () => {
  assert.equal(releasedFile(SIGNED), SIGNED);
  assert.equal(shownFile(releasedFile(SIGNED), "a", true), SIGNED);
});

test("another attachment's file is not shown", () => {
  assert.equal(shownFile(SEALED, "b", true), null);
});
