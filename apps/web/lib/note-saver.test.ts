// Tests for note-saver.ts: when a note is saved (idle pause, longest wait), that saves run one at a time, that an
// unchanged note is not written, that a failed save leaves the note changed, and that a new note waits for its row.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Note } from "./notes";
import { NoteSaver, noteReady, trackCreating, SAVE_IDLE_MS, SAVE_MAX_MS, type SaveState } from "./note-saver";

const note = (over: Partial<Note> = {}): Note => ({ id: "n1", title: "T", body: "B", excerpt: null, pinned: false, useInDrafts: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over });

function setup(initial: Note[] = [note()], persist?: (id: string, f: { title: string; body: string }) => Promise<string>) {
  let notes = initial;
  const states: Record<string, SaveState> = {};
  const writes: { title: string; body: string }[] = [];
  const saver = new NoteSaver({
    notes: () => notes,
    update: (fn) => { notes = fn(notes); },
    setState: (id, s) => { states[id] = s; },
    persist: persist ?? (async (_id, f) => { writes.push(f); return "2026-02-02T00:00:00Z"; }),
    ready: noteReady,
  });
  return { saver, states, writes, notes: () => notes };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

test("an edit saves once typing pauses, and the note shows saved", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const t = setup();
    t.saver.edit("n1", { title: "New" });
    assert.equal(t.states.n1, "saving");
    mock.timers.tick(SAVE_IDLE_MS - 1);
    assert.equal(t.writes.length, 0);
    mock.timers.tick(1);
    await flush();
    assert.deepEqual(t.writes, [{ title: "New", body: "B" }]);
    assert.equal(t.states.n1, "saved");
    assert.equal(t.notes()[0].updatedAt, "2026-02-02T00:00:00Z");
  } finally { mock.timers.reset(); }
});

test("typing that never pauses is still saved within the longest wait", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const t = setup();
    for (let i = 0; i < 12; i++) {
      t.saver.edit("n1", { body: () => `text ${i}` });
      mock.timers.tick(2400);
    }
    // 12 x 2.4s is 28.8s, so each idle wait was reset before it fired; the next edit's wait is capped by the longest wait.
    assert.equal(t.writes.length, 0);
    t.saver.edit("n1", { body: () => "last" });
    mock.timers.tick(SAVE_MAX_MS - 28_800);
    await flush();
    assert.deepEqual(t.writes, [{ title: "T", body: "last" }]);
  } finally { mock.timers.reset(); }
});

test("text given as a function is read when the save is due, not per edit", async () => {
  const t = setup();
  let reads = 0;
  t.saver.edit("n1", { body: () => { reads++; return "from editor"; } });
  t.saver.edit("n1", { body: () => { reads++; return "from editor"; } });
  assert.equal(reads, 0);
  assert.equal(await t.saver.save("n1"), true);
  assert.equal(reads, 1);
  assert.equal(t.writes[0].body, "from editor");
});

test("a note changed back to what was stored is not written again", async () => {
  const t = setup();
  t.saver.setSaved("n1", { title: "T", body: "B" });
  t.saver.edit("n1", { title: "X" });
  t.saver.edit("n1", { title: "T" });
  assert.equal(await t.saver.save("n1"), true);
  assert.equal(t.writes.length, 0);
  assert.equal(t.states.n1, "saved");
});

test("a failed save keeps the note changed and reports false", async () => {
  const t = setup([note()], async () => { throw new Error("offline"); });
  t.saver.edit("n1", { title: "X" });
  assert.equal(await t.saver.save("n1"), false);
  assert.equal(t.states.n1, "failed");
  assert.ok(t.saver.dirty.has("n1"));
  assert.ok(t.saver.busy);
});

test("saves run one at a time, and a change made during one is saved after it", async () => {
  let release!: () => void;
  const order: string[] = [];
  let first = true;
  const t = setup([note()], (_id, f) => {
    order.push(`start ${f.title}`);
    const done = () => { order.push(`end ${f.title}`); return "2026-03-03T00:00:00Z"; };
    if (!first) return Promise.resolve(done());
    first = false;
    return new Promise<string>((r) => { release = () => r(done()); });
  });
  t.saver.edit("n1", { title: "A" });
  const one = t.saver.save("n1");
  await flush();
  t.saver.edit("n1", { title: "B" });
  const two = t.saver.save("n1");
  await flush();
  assert.deepEqual(order, ["start A"]);
  release();
  assert.equal(await one, true);
  assert.equal(await two, true);
  assert.deepEqual(order, ["start A", "end A", "start B", "end B"]);
});

test("a new note is saved only once its row exists", async () => {
  let made!: () => void;
  trackCreating("n1", new Promise<void>((r) => { made = r; }));
  const t = setup();
  t.saver.edit("n1", { title: "X" });
  const saving = t.saver.save("n1");
  await flush();
  assert.equal(t.writes.length, 0);
  made();
  await saving;
  assert.equal(t.writes.length, 1);
  await noteReady("n1");
});

test("a note whose row could not be made does not hang a save", async () => {
  trackCreating("n2", Promise.reject(new Error("no row")));
  await flush();
  await noteReady("n2");
  const t = setup([note({ id: "n2" })]);
  t.saver.edit("n2", { title: "X" });
  assert.equal(await t.saver.save("n2"), true);
});

test("forget cancels the pending save and settle waits for a running one", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const t = setup();
    t.saver.edit("n1", { title: "X" });
    t.saver.forget("n1");
    assert.ok(!t.saver.busy);
    mock.timers.tick(SAVE_MAX_MS);
    await flush();
    assert.equal(t.writes.length, 0);
    await t.saver.settle("n1");
  } finally { mock.timers.reset(); }
});

test("a note that is still unloaded is never written", async () => {
  const t = setup([note({ unloaded: true, body: "" })]);
  t.saver.edit("n1", { title: "X" });
  assert.equal(await t.saver.save("n1"), true);
  assert.equal(t.writes.length, 0);
});

test("upgrading a stale note rewrites it, and skips one with changes waiting", async () => {
  const t = setup([note({ stale: true })]);
  await t.saver.upgrade("n1");
  assert.equal(t.writes.length, 1);
  assert.equal(t.notes()[0].stale, false);
  const u = setup([note({ stale: true })]);
  u.saver.edit("n1", { title: "X" });
  await u.saver.upgrade("n1");
  assert.equal(u.writes.length, 0);
});
