// The save and race logic for notes, kept out of the React provider (components/notes-data.tsx) so it can be tested.
// One NoteSaver holds, per note: what changed, the pending timers, text still to be read from the editor, and the
// save running. Rules: one save at a time per note; a change made during a save is saved after it; a save that
// ends where it began is skipped; a new note is saved only once its row exists. No React, no network: the provider
// passes in how to read and update the list and how to write a note.

import type { Note } from "@/lib/notes";

export type SaveState = "saving" | "saved" | "failed";

/** Typing must pause this long (ms) before a save starts. */
export const SAVE_IDLE_MS = 2500;
/** The longest a change waits (ms) for a save while typing carries on. */
export const SAVE_MAX_MS = 30_000;
/** How long typing must pause (ms) before the note's edited time moves it in the list. */
export const BUMP_IDLE_MS = 1000;

// Notes made here whose row is still being written, by id. A save, a delete or a file waits for it.
const creating = new Map<string, Promise<void>>();

/** Settles once a new note's row exists in the database (at once for any other note). */
export const noteReady = (id: string): Promise<void> => creating.get(id) ?? Promise.resolve();

/** Records that a new note's row is being written. The entry clears itself when the write settles. */
export function trackCreating(id: string, saved: Promise<void>) {
  creating.set(id, saved);
  saved.then(() => { creating.delete(id); }, () => { creating.delete(id); });
}

/** What a save compares: the parts of a note that are stored. */
export const noteKey = (n: { title: string; body: string }) => JSON.stringify([n.title, n.body]);

export interface SaverDeps {
  /** The notes as they stand now. */
  notes: () => Note[];
  /** Changes the list, the way the provider's state update does. */
  update: (fn: (prev: Note[]) => Note[]) => void;
  setState: (id: string, state: SaveState) => void;
  /** Writes a note and resolves to its new edited time. */
  persist: (id: string, fields: { title: string; body: string }) => Promise<string>;
  /** Settles once the note's row exists; the provider passes noteReady. */
  ready: (id: string) => Promise<void>;
}

export class NoteSaver {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Pending "edited just now" updates for notes whose list-visible fields did not change.
  private bumps = new Map<string, ReturnType<typeof setTimeout>>();
  // Notes changed since their last save, when each first changed, and the save running for each.
  readonly dirty = new Set<string>();
  private firstDirty = new Map<string, number>();
  readonly running = new Map<string, Promise<void>>();
  // Text still to be read from the editor, the newest text read from it, and what was last saved.
  private getters = new Map<string, () => string>();
  private latest = new Map<string, string>();
  private lastSaved = new Map<string, string>();

  constructor(private deps: SaverDeps) {}

  /** Whether a save is due or running, for the "leave this page?" prompt. */
  get busy() { return this.dirty.size > 0 || this.running.size > 0; }

  /** Whether a reload of the list must leave this note alone: it is changing or the editor holds newer text. */
  isEditing(id: string) { return this.dirty.has(id) || this.getters.has(id); }

  /** Forgets text read from the editor, once the list has newer text from the database. */
  dropLatest(id: string) { this.latest.delete(id); }

  /** Records what is stored for a note that was just made or just opened, so an unchanged save is skipped. */
  setSaved(id: string, note: { title: string; body: string }) { this.lastSaved.set(id, noteKey(note)); }

  /** Like setSaved, for a note's text just downloaded: not while the note has unsaved changes. */
  opened(id: string, note: { title: string; body: string }) {
    if (!this.dirty.has(id)) this.setSaved(id, note);
  }

  /** A new note could not be written, so nothing of it is left to save. */
  abandon(id: string) { this.dirty.delete(id); }

  /** Reads the text waiting in the editor into the note. */
  resolve = (id: string) => {
    const read = this.getters.get(id);
    if (!read) return;
    this.getters.delete(id);
    let body: string;
    try { body = read(); } catch { return; }
    this.latest.set(id, body);
    this.deps.update((prev) => prev.map((n) => (n.id === id ? { ...n, body } : n)));
  };

  /** The note as it stands now, including text read from the editor but not yet shown in state. */
  current = (id: string): Note | undefined => {
    const note = this.deps.notes().find((n) => n.id === id);
    const body = this.latest.get(id);
    return note && body !== undefined ? { ...note, body } : note;
  };

  /** Saves the note, resolving to false when the save failed (the note is then still changed). */
  save = async (id: string): Promise<boolean> => {
    this.resolve(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    // A new note is saved only once its row exists.
    await this.deps.ready(id).catch(() => {});
    // One save at a time per note; a change made during it is saved after.
    await this.running.get(id);
    this.resolve(id);
    if (!this.dirty.has(id)) return true;
    const note = this.current(id);
    if (!note) { this.dirty.delete(id); return true; }
    this.dirty.delete(id);
    this.firstDirty.delete(id);
    if (note.unloaded) return true;
    // Typing that ended where it began costs nothing.
    const key = noteKey(note);
    if (this.lastSaved.get(id) === key) {
      this.deps.setState(id, this.dirty.has(id) ? "saving" : "saved");
      return true;
    }
    this.deps.setState(id, "saving");
    let saved = true;
    const run = this.deps.persist(id, { title: note.title, body: note.body })
      .then((updatedAt) => {
        this.lastSaved.set(id, key);
        if (!this.dirty.has(id)) this.deps.update((prev) => prev.map((n) => (n.id === id ? { ...n, updatedAt, stale: false } : n)));
        this.deps.setState(id, this.dirty.has(id) ? "saving" : "saved");
      })
      .catch(() => {
        saved = false;
        this.dirty.add(id);
        this.deps.setState(id, "failed");
      })
      .finally(() => this.running.delete(id));
    this.running.set(id, run);
    await run;
    return saved;
  };

  /**
   * A note stored as plaintext, or without an excerpt, is rewritten sealed when it is opened. The save joins the
   * note's queue, so a change typed meanwhile is saved after it.
   */
  upgrade = async (id: string): Promise<void> => {
    const note = this.current(id);
    if (!note || !note.stale || note.unloaded || this.dirty.has(id) || this.running.has(id)) return;
    const key = noteKey(note);
    const run = this.deps.persist(id, { title: note.title, body: note.body })
      .then((updatedAt) => {
        this.lastSaved.set(id, key);
        this.deps.update((prev) => prev.map((n) => (n.id === id ? { ...n, updatedAt: this.dirty.has(id) ? n.updatedAt : updatedAt, stale: false } : n)));
      })
      .catch(() => {})
      .finally(() => this.running.delete(id));
    this.running.set(id, run);
    await run;
  };

  /** Records a change to a note and schedules its save. The text can be a function, read when the save is due. */
  edit = (id: string, fields: { title?: string; body?: string | (() => string) }) => {
    const { body, ...rest } = fields;
    if (typeof body === "function") this.getters.set(id, body);
    else if (body !== undefined) { this.getters.delete(id); this.latest.set(id, body); }
    // The list shows the title, excerpt and order, none of which move while only the editor's text changes (it is read
    // lazily). Committing then would re-sort and re-render every consumer per keystroke, so only a real change commits,
    // and the "edited" time catches up once typing pauses.
    const note = this.deps.notes().find((n) => n.id === id);
    const shown = (Object.keys(rest) as (keyof typeof rest)[]).some((k) => note?.[k] !== rest[k]) || (typeof body === "string" && body !== note?.body);
    clearTimeout(this.bumps.get(id));
    if (shown) {
      const updatedAt = new Date().toISOString();
      this.deps.update((prev) => prev.map((n) => (n.id === id ? { ...n, ...rest, ...(typeof body === "string" ? { body } : {}), updatedAt } : n)));
    } else {
      this.bumps.set(id, setTimeout(() => {
        this.bumps.delete(id);
        const updatedAt = new Date().toISOString();
        this.deps.update((prev) => prev.map((n) => (n.id === id ? { ...n, updatedAt } : n)));
      }, BUMP_IDLE_MS));
    }
    this.dirty.add(id);
    this.deps.setState(id, "saving");
    // Saves once typing has paused, and in any case within the longest wait after the first change.
    const now = Date.now();
    const first = this.firstDirty.get(id) ?? now;
    this.firstDirty.set(id, first);
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => void this.save(id), Math.max(0, Math.min(SAVE_IDLE_MS, first + SAVE_MAX_MS - now))));
  };

  /** Saves every note with a change waiting (leaving the page, or the provider going away). */
  flushAll = () => { for (const id of this.dirty) void this.save(id); };

  /**
   * Resolves once the note's row exists and a save already running has ended, so a delete cannot be followed by a
   * write that brings the note back. Call forget first, so no new save starts.
   */
  async settle(id: string) {
    await this.deps.ready(id).catch(() => {});
    await this.running.get(id);
    // A save that failed meanwhile marks the note changed again; it is going, so nothing is left to save.
    this.dirty.delete(id);
  }

  /** Cancels timers and drops pending text and changes for a note that is going away, at once. */
  forget(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    clearTimeout(this.bumps.get(id));
    this.bumps.delete(id);
    this.dirty.delete(id);
    this.firstDirty.delete(id);
    this.getters.delete(id);
    this.latest.delete(id);
  }
}
