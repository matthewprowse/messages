// Tests for signature.ts: the signature goes below the text once, never on a chat, and never twice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendSignature, carriesSignature } from "./signature";

const sig = "Matt Prowse\nKonva\n+27 82 000 0000";

test("only email carries a signature", () => {
  assert.equal(carriesSignature("email"), true);
  for (const c of ["whatsapp", "linkedin", "instagram"] as const) assert.equal(carriesSignature(c), false);
});

test("appendSignature puts it below the text after a blank line", () => {
  assert.equal(appendSignature("Thanks, see you then.\n", sig), `Thanks, see you then.\n\n${sig}`);
});

test("appendSignature does not double a signature already at the end", () => {
  const once = appendSignature("Thanks.", sig);
  assert.equal(appendSignature(once, sig), once);
  assert.equal(appendSignature(`Thanks.\n\nMatt Prowse  Konva\n+27 82 000 0000  `, sig), `Thanks.\n\nMatt Prowse  Konva\n+27 82 000 0000  `);
});

test("appendSignature leaves an empty body, or no signature, alone", () => {
  assert.equal(appendSignature("", sig), "");
  assert.equal(appendSignature("Hello", "  "), "Hello");
});

test("a signature quoted mid-text is not the end of it", () => {
  assert.equal(appendSignature(`${sig}\n\nAnd one more thing.`, sig), `${sig}\n\nAnd one more thing.\n\n${sig}`);
});
