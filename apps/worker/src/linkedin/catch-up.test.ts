// Tests for linkedin/catch-up.ts: a live catch-up reads every changed conversation, the first run only the latest, and the token waits for failures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { catchUpTargets, mayAdvanceToken } from "./catch-up";
import type { LinkedInConversation } from "./helper";

const conv = (n: number, extra: Partial<LinkedInConversation> = {}) =>
  ({ urn: `c${n}`, participants: [{ id: "me" }, { id: `p${n}` }], group: false, lastActivityAt: n, ...extra }) as unknown as LinkedInConversation;

test("a live catch-up reads every changed conversation, newest first, and skips spam", () => {
  const all = [conv(1), conv(3), conv(2, { categories: ["SPAM"] }), conv(4)];
  assert.deepEqual(catchUpTargets(all, "me", true, 2).map((c) => c.urn), ["c4", "c3", "c1"]);
});

test("the first run reads only the latest conversations", () => {
  const all = [conv(1), conv(3), conv(2), conv(4)];
  assert.deepEqual(catchUpTargets(all, "me", false, 2).map((c) => c.urn), ["c4", "c3"]);
});

test("the sync token moves only when nothing failed", () => {
  assert.equal(mayAdvanceToken(0), true);
  assert.equal(mayAdvanceToken(1), false);
});
