import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
process.env.ENCRYPTION_KEY ??= "test";

const { db } = await import("../db");
const { MissingFiles } = await import("./attachment-files");
const rules = await import("../storage-rules");

const MB = 1024 * 1024;
const GB = 1024 * MB;

function rows() {
  const meta = { account_id: "a", provider_meta: {} };
  return [
    { id: "r1", user_id: "u1", kind: "pdf", size_bytes: 1 * MB, message_id: "m1", messages: meta },
    { id: "r2", user_id: "u1", kind: "video", size_bytes: 30 * MB, message_id: "m2", messages: meta },
    { id: "r3", user_id: "u2", kind: "image", size_bytes: 1 * MB, message_id: "m3", messages: meta },
  ];
}

function fake(usageByUser: Record<string, number>) {
  const marked: { id: string; patch: unknown }[] = [];
  Object.assign(db, {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      if (table === "storage_usage") return { select: () => ({ eq: (_c: string, user: string) => Promise.resolve({ data: [{ bytes: usageByUser[user] ?? 0 }], error: null }) }) };
      const chain: Record<string, unknown> = {
        select: () => chain,
        is: () => chain,
        eq: (c: string, v: unknown) => (c === "id" ? Promise.resolve({ error: null }).then(() => ({ error: null })) : chain),
        lte: () => chain,
        or: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: rows(), error: null }),
        update: (patch: unknown) => ({ eq: (_c: string, id: string) => (marked.push({ id, patch }), Promise.resolve({ error: null })) }),
      };
      return chain;
    },
  });
  return marked;
}

test("a big video is marked as a link and never fetched; the rest of the page still is", async () => {
  rules.resetUsageCache();
  const marked = fake({});
  const todo = await new MissingFiles("a").next();
  assert.deepEqual(todo.map((t) => t.id), ["r1", "r3"]);
  assert.deepEqual(marked, [{ id: "r2", patch: { not_kept: "video_link" } }]);
});

test("nothing is fetched for someone whose storage is at the cap", async () => {
  rules.resetUsageCache();
  fake({ u1: 20 * GB });
  const todo = await new MissingFiles("a").next();
  assert.deepEqual(todo.map((t) => t.id), ["r3"]);
});
