// Tests for applying a catch-up's changed conversations to the list.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeThreads } from "./merge-threads";
import type { Thread } from "./types";

const t = (id: string, lastMessageAt: string) => ({ id, lastMessageAt } as Thread);

test("changed threads replace, new ones are added, and all are newest first", () => {
  const out = mergeThreads([t("a", "2026-01-03"), t("b", "2026-01-02")], [t("b", "2026-01-05"), t("c", "2026-01-04")], new Set());
  assert.deepEqual(out.map((x) => x.id), ["b", "c", "a"]);
});

test("threads in the bin leave the list", () => {
  const out = mergeThreads([t("a", "2026-01-03"), t("b", "2026-01-02")], [t("a", "2026-01-06")], new Set(["a"]));
  assert.deepEqual(out.map((x) => x.id), ["b"]);
});
