// The save and race logic for notes, kept out of the React provider (components/notes-data.tsx) so it can be tested.
// One NoteSaver holds, per note: what changed, the pending timers, text still to be read from the editor, and the
// save running. Rules: one save at a time per note; a change made during a save is saved after it; a save that
// ends where it began is skipped; a new note is saved only once its row exists. A save names the version it read
// (the row's edited time) and is refused if the row moved on, so another tab or device is never overwritten
// silently: the note then waits as a conflict until the user picks. A failed save retries by itself with backoff.
// No React, no network: the provider passes in how to read and update the list and how to write a note.

import type { Note } from "@/lib/notes";

export type SaveState = "saving" | "saved" | "failed" | "conflict";

/** Thrown by a write when the row was changed elsewhere since this tab last read it. */
export class NoteConflict extends Error {
  constructor() { super("The note changed elsewhere."); }
}

/** How a write is made: the row version it expects, and whether it must survive the page closing. */
export interface PersistOpts { expected?: string; keepalive?: boolean }

/** The stored text of a note as another tab or device left it. */
export interface RemoteNote { title: string; body: string; updatedAt: string }

/** Waits (ms) before each retry of a failed save; the last one repeats. */
export const RETRY_MS = [2000, 5000, 15_000, 30_000, 60_000];
/** A page-closing request carries about 64 KB at most, and sealed text grows, so a longer note (characters) is not trusted to it. */
export const KEEPALIVE_MAX_CHARS = 40_000;

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

/** Whether a new note's row is still being written. */
export const isCreating = (id: string): boolean => creating.has(id);

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
  persist: (id: string, fields: { title: string; body: string }, opts: PersistOpts) => Promise<string>;
  /** Reads the row as stored now, or null when it is gone. Tells a real conflict from a metadata-only change. */
  remote?: (id: string) => Promise<RemoteNote | null>;
  /** Writes the row again (it was deleted elsewhere, or never got made) and resolves to its edited time. */
  recreate?: (id: string) => Promise<string>;
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
  // The row version each note was last read or written at, newer than the list's while a state update is pending.
  private versions = new Map<string, string>();
  // Failed saves in a row per note, and the timer for the next try.
  private failures = new Map<string, number>();
  private retries = new Map<string, ReturnType<typeof setTimeout>>();
  // Notes whose row changed elsewhere: what is there now (null: the row is gone). Their saves wait for the user.
  private conflicts = new Map<string, RemoteNote | null>();

  constructor(private deps: SaverDeps) {}

  /** Whether a save is due or running. */
  get busy() { return this.dirty.size > 0 || this.running.size > 0; }

  /**
   * Whether closing the page now could lose text: a save is failing or in conflict, the device is offline, or a
   * note is too long for the page-closing request. A save that is merely about to run is not a reason to warn.
   */
  get unsaved() {
    if (this.conflicts.size > 0) return true;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    for (const id of this.dirty) {
      if (offline || this.failures.has(id)) return true;
      const note = this.current(id);
      if (note && note.body.length > KEEPALIVE_MAX_CHARS) return true;
    }
    return false;
  }

  /** The row version to expect when saving: the last one written or read. */
  version(id: string): string | undefined {
    return this.versions.get(id) ?? this.deps.notes().find((n) => n.id === id)?.serverAt;
  }

  /** Records the row version a note was just read or created at. */
  setVersion(id: string, at: string) { this.versions.set(id, at); }

  /** What another device left when this note is waiting on the user; null when the row is gone; undefined when no conflict. */
  conflictOf(id: string): RemoteNote | null | undefined { return this.conflicts.get(id); }

  /** Whether a reload of the list must leave this note alone: it is changing or the editor holds newer text. */
  isEditing(id: string) { return this.dirty.has(id) || this.getters.has(id); }

  /** Forgets text read from the editor and the version held, once the list has newer text from the database. */
  dropLatest(id: string) { this.latest.delete(id); this.versions.delete(id); }

  /** Records what is stored for a note that was just made or just opened, so an unchanged save is skipped. */
  setSaved(id: string, note: { title: string; body: string }) { this.lastSaved.set(id, noteKey(note)); }

  /** Like setSaved, for a note's text just downloaded: not while the note has unsaved changes. */
  opened(id: string, note: { title: string; body: string }) {
    if (!this.dirty.has(id)) this.setSaved(id, note);
  }

  /** A new note could not be written: it is kept, shown as not saved, and written again by the next save. */
  markFailed(id: string) {
    this.dirty.add(id);
    // Nothing is stored for it, so an unchanged note must not be skipped as already saved.
    this.lastSaved.delete(id);
    this.deps.setState(id, "failed");
    this.scheduleRetry(id);
  }

  private scheduleRetry(id: string) {
    const n = this.failures.get(id) ?? 0;
    this.failures.set(id, n + 1);
    clearTimeout(this.retries.get(id));
    const timer = setTimeout(() => { this.retries.delete(id); void this.save(id); }, RETRY_MS[Math.min(n, RETRY_MS.length - 1)]);
    // A pending retry must not hold a test run (node) open; in the browser the timer is a number and this is skipped.
    (timer as { unref?: () => void }).unref?.();
    this.retries.set(id, timer);
  }

  /** Tries every failed save now (the device came back online, or the tab was shown again). */
  retryNow() {
    for (const id of this.dirty) if (this.failures.has(id) && !this.conflicts.has(id) && !this.running.has(id)) void this.save(id);
  }

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

  /**
   * Saves the note, resolving to false when the save failed or is in conflict (the note is then still changed).
   * keepalive is for a page that is closing: the write is sent so the browser finishes it after the page is gone.
   */
  save = async (id: string, opts: { keepalive?: boolean; rebased?: boolean } = {}): Promise<boolean> => {
    this.resolve(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    clearTimeout(this.retries.get(id));
    this.retries.delete(id);
    // A new note is saved only once its row exists.
    await this.deps.ready(id).catch(() => {});
    // One save at a time per note; a change made during it is saved after.
    await this.running.get(id);
    this.resolve(id);
    if (this.conflicts.has(id)) return false;
    if (!this.dirty.has(id)) return true;
    const note = this.current(id);
    if (!note) { this.dirty.delete(id); return true; }
    this.dirty.delete(id);
    this.firstDirty.delete(id);
    // A note whose text could not be opened is never written: it would replace the real text with nothing.
    if (note.unloaded || note.failed) return true;
    // Typing that ended where it began costs nothing.
    const key = noteKey(note);
    if (this.lastSaved.get(id) === key) {
      this.deps.setState(id, this.dirty.has(id) ? "saving" : "saved");
      return true;
    }
    this.deps.setState(id, "saving");
    let saved = true;
    let rebase = false;
    const run = this.deps.persist(id, { title: note.title, body: note.body }, { expected: this.version(id), keepalive: opts.keepalive })
      .then((updatedAt) => {
        this.lastSaved.set(id, key);
        this.versions.set(id, updatedAt);
        this.failures.delete(id);
        this.deps.update((prev) => prev.map((n) => (n.id === id ? { ...n, serverAt: updatedAt, ...(this.dirty.has(id) ? {} : { updatedAt }), stale: false } : n)));
        this.deps.setState(id, this.dirty.has(id) ? "saving" : "saved");
      })
      .catch(async (err) => {
        saved = false;
        this.dirty.add(id);
        if (err instanceof NoteConflict) {
          const outcome = await this.onConflict(id, opts.rebased);
          if (outcome === "rebased") rebase = true;
          if (outcome !== "failed") return;
        }
        this.deps.setState(id, "failed");
        this.scheduleRetry(id);
      })
      .finally(() => this.running.delete(id));
    this.running.set(id, run);
    await run;
    // Only the row's edited time had moved (a pin, say): the same text is written again against the new version.
    if (rebase) return this.save(id, { ...opts, rebased: true });
    return saved;
  };

  // The row moved on since this tab read it. If what is stored is the text this tab last saved, only metadata changed
  // and the save can go again; otherwise another device edited the note and the user decides.
  private async onConflict(id: string, alreadyRebased?: boolean): Promise<"rebased" | "waiting" | "failed"> {
    let remote: RemoteNote | null;
    try { remote = this.deps.remote ? await this.deps.remote(id) : null; } catch { return "failed"; }
    // A row that never got made (no version was ever read for it) is simply made, with no one to ask.
    if (!remote && !alreadyRebased && this.version(id) === undefined && this.deps.recreate) {
      try { this.versions.set(id, await this.deps.recreate(id)); return "rebased"; } catch { return "failed"; }
    }
    if (remote && !alreadyRebased && this.lastSaved.get(id) === noteKey(remote)) {
      this.versions.set(id, remote.updatedAt);
      return "rebased";
    }
    this.conflicts.set(id, remote);
    this.deps.setState(id, "conflict");
    return "waiting";
  }

  /**
   * Resolves a conflict by keeping this tab's text: it is written over what is stored. The caller keeps the other
   * version first if it matters (the provider's Keep Both). A row that is gone is written again.
   */
  keepMine = async (id: string): Promise<boolean> => {
    const remote = this.conflicts.get(id);
    if (remote === undefined) return true;
    try {
      this.versions.set(id, remote ? remote.updatedAt : await this.deps.recreate!(id));
    } catch { return false; }
    this.conflicts.delete(id);
    this.dirty.add(id);
    return this.save(id);
  };

  /** Resolves a conflict by taking what is stored: this tab's changes are dropped. Returns it, or null when there is none. */
  useTheirs(id: string): RemoteNote | null {
    const remote = this.conflicts.get(id);
    if (!remote) return null;
    this.forget(id);
    this.versions.set(id, remote.updatedAt);
    this.lastSaved.set(id, noteKey(remote));
    this.deps.update((prev) => prev.map((n) => (n.id === id ? { ...n, title: remote.title, body: remote.body, excerpt: null, serverAt: remote.updatedAt, updatedAt: remote.updatedAt, revision: (n.revision ?? 0) + 1 } : n)));
    this.deps.setState(id, "saved");
    return remote;
  }

  /**
   * A note stored as plaintext, or without an excerpt, is rewritten sealed when it is opened. The save joins the
   * note's queue, so a change typed meanwhile is saved after it.
   */
  upgrade = async (id: string): Promise<void> => {
    const note = this.current(id);
    if (!note || !note.stale || note.unloaded || note.failed || this.dirty.has(id) || this.running.has(id) || this.conflicts.has(id)) return;
    const key = noteKey(note);
    const run = this.deps.persist(id, { title: note.title, body: note.body }, { expected: this.version(id) })
      .then((updatedAt) => {
        this.lastSaved.set(id, key);
        this.versions.set(id, updatedAt);
        this.deps.update((prev) => prev.map((n) => (n.id === id ? { ...n, serverAt: updatedAt, updatedAt: this.dirty.has(id) ? n.updatedAt : updatedAt, stale: false } : n)));
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
    clearTimeout(this.retries.get(id));
    this.retries.delete(id);
    // A note in conflict keeps the text typed but saves nothing until the user picks a version.
    if (this.conflicts.has(id)) { this.deps.setState(id, "conflict"); return; }
    this.deps.setState(id, "saving");
    // Saves once typing has paused, and in any case within the longest wait after the first change.
    const now = Date.now();
    const first = this.firstDirty.get(id) ?? now;
    this.firstDirty.set(id, first);
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => void this.save(id), Math.max(0, Math.min(SAVE_IDLE_MS, first + SAVE_MAX_MS - now))));
  };

  /** Saves every note with a change waiting (leaving the page, or the provider going away). */
  flushAll = (keepalive = false) => { for (const id of this.dirty) if (!this.conflicts.has(id)) void this.save(id, { keepalive }); };

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
    clearTimeout(this.retries.get(id));
    this.retries.delete(id);
    this.failures.delete(id);
    this.conflicts.delete(id);
  }
}
