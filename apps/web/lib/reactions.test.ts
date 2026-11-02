// reactions.ts: WhatsApp can be reacted on, LinkedIn (no helper command yet) and everything else cannot.

import assert from "node:assert/strict";
import { test } from "node:test";
import { canReactOn } from "./reactions";

test("only WhatsApp takes a reaction", () => {
  assert.equal(canReactOn("whatsapp"), true);
  for (const c of ["linkedin", "email", "instagram", "teams", "", null, undefined]) assert.equal(canReactOn(c), false, String(c));
});
