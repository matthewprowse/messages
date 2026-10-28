// Tests for shard assignment: hash stability, even spread, one owner per account and the settings parser.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { owns, parseShard, shardOf } from "./shard";

test("the hash is stable for a known id", () => {
  const id = "0000000a-1111-4222-8333-444444444444";
  assert.equal(shardOf(id, 4), 10 % 4);
  assert.equal(shardOf(id, 4), shardOf(id, 4));
  assert.equal(shardOf(id.toUpperCase(), 4), 10 % 4);
});

test("one shard owns every account", () => {
  for (let i = 0; i < 200; i++) assert.equal(owns({ index: 0, count: 1 }, randomUUID()), true);
});

test("each account has exactly one owner", () => {
  for (let i = 0; i < 200; i++) {
    const id = randomUUID();
    const owners = [0, 1, 2].filter((index) => owns({ index, count: 3 }, id));
    assert.equal(owners.length, 1);
  }
});

test("random ids spread roughly evenly", () => {
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 4000; i++) counts[shardOf(randomUUID(), 4)]++;
  for (const c of counts) assert.ok(c > 800 && c < 1200, `uneven split ${counts.join(",")}`);
});

test("an id that is not a uuid still lands on one shard", () => {
  const s = shardOf("not-a-uuid", 3);
  assert.ok(s >= 0 && s < 3);
  assert.equal(s, shardOf("not-a-uuid", 3));
});

test("parseShard defaults to 0 of 1 and rejects bad settings", () => {
  assert.deepEqual(parseShard({}), { index: 0, count: 1 });
  assert.deepEqual(parseShard({ WORKER_SHARD_INDEX: "1", WORKER_SHARD_COUNT: "3" }), { index: 1, count: 3 });
  assert.ok(parseShard({ WORKER_SHARD_INDEX: "3", WORKER_SHARD_COUNT: "3" }).error);
  assert.ok(parseShard({ WORKER_SHARD_INDEX: "-1", WORKER_SHARD_COUNT: "3" }).error);
  assert.ok(parseShard({ WORKER_SHARD_COUNT: "0" }).error);
  assert.ok(parseShard({ WORKER_SHARD_COUNT: "two" }).error);
});
