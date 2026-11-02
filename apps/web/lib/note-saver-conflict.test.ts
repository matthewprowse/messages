// Tests for note-saver.ts when saves go wrong: a note changed on another device (conflict, keep both, take theirs),
// failed saves that retry with backoff, notes whose text never opened, page-closing saves, and when leaving the
// page deserves a warning. The plain save rules are in note-saver.test.ts.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Note } from "./notes";
import { KEEPALIVE_MAX_CHARS, NoteConflict, NoteSaver, RETRY_MS, noteKey, type PersistOpts, type RemoteNote, type SaveState } from "./note-saver";

const note = (over: Partial<Note> = {}): Note => ({ id: "n1", title: "T", body: "B", excerpt: null, pinned: false, useInDrafts: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", serverAt: "v1", ...over });
const flush = () => new Promise<void>((r) => setImmediate(r));

interface Calls { id: string; fields: { title: string; body: string }; opts: PersistOpts }

function setup(opts: {
  initial?: Note[];
  persist?: (call: Calls, n: number) => Promise<string>;
  remote?: () => Promise<RemoteNote | null>;
  recreate?: (id: string) => Promise<string>;
} = {}) {
  let notes = opts.initial ?? [note()];
  const states: Record<string, SaveState> = {};
  const calls: Calls[] = [];
  const recreated: string[] = [];
  const saver = new NoteSaver({
    notes: () => notes,
    update: (fn) => { notes = fn(notes); },
    setState: (id, s) => { states[id] = s; },
    persist: async (id, fields, o) => {
      calls.push({ id, fields, opts: o });
      return (opts.persist ?? (async (_c, n) => `v${n + 1}`))({ id, fields, opts: o }, calls.length);
    },
    ready: async () => {},
    remote: opts.remote,
    recreate: opts.recreate ?? (async (id) => { recreated.push(id); return "created"; }),
  });
  return { saver, states, calls, recreated, notes: () => notes };
}

test("a save names the version it read, and the next one names the version just written", async () => {
  const t = setup();
  t.saver.edit("n1", { title: "A" });
  await t.saver.save("n1");
  t.saver.edit("n1", { title: "B" });
  await t.saver.save("n1");
  assert.deepEqual(t.calls.map((c) => c.opts.expected), ["v1", "v2"]);
  assert.equal(t.notes()[0].serverAt, "v3");
});

test("a note changed on another device stops as a conflict and nothing more is written", async () => {
  const other: RemoteNote = { title: "Theirs", body: "Their text", updatedAt: "v9" };
  const t = setup({ persist: async () => { throw new NoteConflict(); }, remote: async () => other });
  t.saver.setSaved("n1", { title: "T", body: "B" });
  t.saver.edit("n1", { title: "Mine" });
  assert.equal(await t.saver.save("n1"), false);
  assert.equal(t.states.n1, "conflict");
  assert.deepEqual(t.saver.conflictOf("n1"), other);
  assert.ok(t.saver.unsaved);
  // Typing carries on locally but no save is scheduled or run.
  t.saver.edit("n1", { title: "Mine again" });
  assert.equal(t.states.n1, "conflict");
  assert.equal(await t.saver.save("n1"), false);
  assert.equal(t.calls.length, 1);
});

test("a change that only moved the edited time (a pin) is saved again against the new version", async () => {
  let n = 0;
  const t = setup({
    persist: async () => { if (++n === 1) throw new NoteConflict(); return "v5"; },
    remote: async () => ({ title: "T", body: "B", updatedAt: "v4" }),
  });
  t.saver.setSaved("n1", { title: "T", body: "B" });
  t.saver.edit("n1", { title: "Mine" });
  assert.equal(await t.saver.save("n1"), true);
  assert.deepEqual(t.calls.map((c) => c.opts.expected), ["v1", "v4"]);
  assert.equal(t.states.n1, "saved");
  assert.equal(t.saver.conflictOf("n1"), undefined);
});

test("Keep Mine writes over the other version, using its edited time", async () => {
  let n = 0;
  const t = setup({
    persist: async () => { if (++n === 1) throw new NoteConflict(); return "v10"; },
    remote: async () => ({ title: "Theirs", body: "X", updatedAt: "v9" }),
  });
  t.saver.setSaved("n1", { title: "T", body: "B" });
  t.saver.edit("n1", { title: "Mine" });
  await t.saver.save("n1");
  assert.equal(await t.saver.keepMine("n1"), true);
  assert.equal(t.calls[1].opts.expected, "v9");
  assert.equal(t.calls[1].fields.title, "Mine");
  assert.equal(t.states.n1, "saved");
  assert.ok(!t.saver.unsaved);
});

test("Use Other Version drops local changes, takes the stored text and writes nothing", async () => {
  const t = setup({ persist: async () => { throw new NoteConflict(); }, remote: async () => ({ title: "Theirs", body: "Their text", updatedAt: "v9" }) });
  t.saver.setSaved("n1", { title: "T", body: "B" });
  t.saver.edit("n1", { title: "Mine" });
  await t.saver.save("n1");
  const got = t.saver.useTheirs("n1");
  assert.equal(got?.title, "Theirs");
  const n = t.notes()[0];
  assert.deepEqual([n.title, n.body, n.serverAt, n.revision], ["Theirs", "Their text", "v9", 1]);
  assert.equal(t.states.n1, "saved");
  assert.ok(!t.saver.busy);
  assert.equal(t.saver.conflictOf("n1"), undefined);
  assert.equal(t.calls.length, 1);
});

test("a note deleted elsewhere waits for the user, and saving again makes the row anew", async () => {
  let n = 0;
  const t = setup({ persist: async () => { if (++n === 1) throw new NoteConflict(); return "v2"; }, remote: async () => null });
  t.saver.edit("n1", { title: "Mine" });
  await t.saver.save("n1");
  assert.equal(t.saver.conflictOf("n1"), null);
  assert.equal(t.saver.useTheirs("n1"), null);
  assert.equal(await t.saver.keepMine("n1"), true);
  assert.deepEqual(t.recreated, ["n1"]);
  assert.equal(t.calls[1].opts.expected, "created");
});

test("a note that never got its row is written again by the next save without asking", async () => {
  let n = 0;
  const t = setup({ initial: [note({ serverAt: undefined })], persist: async () => { if (++n === 1) throw new NoteConflict(); return "v1"; }, remote: async () => null });
  t.saver.markFailed("n1");
  assert.equal(t.states.n1, "failed");
  assert.equal(await t.saver.save("n1"), true);
  assert.deepEqual(t.recreated, ["n1"]);
  assert.equal(t.states.n1, "saved");
});

test("a failed save retries by itself, waiting longer each time, and stops once it works", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    let n = 0;
    const t = setup({ persist: async () => { if (++n < 3) throw new Error("offline"); return "v7"; } });
    t.saver.edit("n1", { title: "X" });
    assert.equal(await t.saver.save("n1"), false);
    assert.equal(t.states.n1, "failed");
    mock.timers.tick(RETRY_MS[0] - 1);
    await flush();
    assert.equal(t.calls.length, 1);
    mock.timers.tick(1);
    await flush();
    assert.equal(t.calls.length, 2);
    assert.equal(t.states.n1, "failed");
    mock.timers.tick(RETRY_MS[1]);
    await flush();
    assert.equal(t.calls.length, 3);
    assert.equal(t.states.n1, "saved");
    assert.ok(!t.saver.unsaved);
    mock.timers.tick(RETRY_MS[2] * 2);
    await flush();
    assert.equal(t.calls.length, 3);
  } finally { mock.timers.reset(); }
});

test("retryNow tries failed saves at once, as when the device comes back online", async () => {
  let n = 0;
  const t = setup({ persist: async () => { if (++n === 1) throw new Error("offline"); return "v2"; } });
  t.saver.edit("n1", { title: "X" });
  await t.saver.save("n1");
  assert.ok(t.saver.unsaved);
  t.saver.retryNow();
  await flush();
  assert.equal(t.states.n1, "saved");
  assert.equal(t.calls.length, 2);
});

test("a note whose text failed to open is never written, even after an edit", async () => {
  const t = setup({ initial: [note({ failed: true, body: "" })] });
  t.saver.edit("n1", { title: "X" });
  assert.equal(await t.saver.save("n1"), true);
  assert.equal(t.calls.length, 0);
  assert.ok(!t.saver.busy);
});

test("flushAll for a closing page asks for a keepalive write and skips notes in conflict", async () => {
  const t = setup({ initial: [note(), note({ id: "n2" })], persist: async () => "v2" });
  t.saver.edit("n1", { title: "X" });
  t.saver.edit("n2", { title: "Y" });
  t.saver.flushAll(true);
  await flush();
  assert.deepEqual(t.calls.map((c) => c.opts.keepalive), [true, true]);
  const c = setup({ persist: async () => { throw new NoteConflict(); }, remote: async () => ({ title: "Z", body: "Z", updatedAt: "v8" }) });
  c.saver.edit("n1", { title: "X" });
  await c.saver.save("n1");
  c.saver.flushAll(true);
  await flush();
  assert.equal(c.calls.length, 1);
});

test("leaving the page warns only when text could really be lost", async () => {
  const t = setup({ initial: [note({ body: "x".repeat(KEEPALIVE_MAX_CHARS + 1) })], persist: async () => "v2" });
  assert.ok(!t.saver.unsaved);
  // A change about to be saved is not worth a prompt: the closing page sends it.
  const short = setup();
  short.saver.edit("n1", { title: "X" });
  assert.ok(short.saver.busy);
  assert.ok(!short.saver.unsaved);
  // A note too long for the closing request is.
  t.saver.edit("n1", { title: "X" });
  assert.ok(t.saver.unsaved);
});

test("forget clears a conflict and pending retries", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const t = setup({ persist: async () => { throw new Error("offline"); } });
    t.saver.edit("n1", { title: "X" });
    await t.saver.save("n1");
    t.saver.forget("n1");
    mock.timers.tick(RETRY_MS[0] * 2);
    await flush();
    assert.equal(t.calls.length, 1);
    assert.ok(!t.saver.unsaved);
  } finally { mock.timers.reset(); }
});

test("noteKey covers the title and the text", () => {
  assert.notEqual(noteKey({ title: "A", body: "B" }), noteKey({ title: "A", body: "C" }));
});
