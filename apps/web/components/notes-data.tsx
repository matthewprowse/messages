"use client";

// The notes list and saving, shared by the list and the open note. A title changes the note here at once;
// the text is read from the editor only when a save is due, so each keystroke does not turn the whole note
// into markdown. A save runs once typing has paused for a moment, and at the latest every half minute, and
// is skipped when nothing changed since the last one. Kept between visits, so coming back to Notes shows
// the list straight away while it refreshes. The list loads titles and excerpts only; a note's text is
// downloaded and opened when the note opens, in the background for older notes without an excerpt, and for
// every note when searching.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { createNote, deleteNote, loadNoteBodies, loadNotes, pinNote, prefetchNoteFiles, removeNoteFiles, saveNote, useNoteInDrafts, type Note, type NoteFile } from "@/lib/notes";
import { isBlankNote, noteExcerpt, sortNotes, unusedFiles } from "@/lib/note-text";

const SAVE_IDLE_MS = 2500;
const SAVE_MAX_MS = 30_000;
/** How long typing must pause (ms) before the note's edited time moves it in the list. */
const BUMP_IDLE_MS = 1000;
const OPEN_BATCH = 20;
// The newest notes are opened as soon as the list loads, so the ones most likely to be clicked open at once.
const WARM_NEWEST = 8;

// Notes made here whose row is still being written, by id. A save, a delete or a file waits for it.
const creating = new Map<string, Promise<void>>();

/** Settles once a new note's row exists in the database (at once for any other note). */
export const noteReady = (id: string): Promise<void> => creating.get(id) ?? Promise.resolve();

const keyOf = (n: { title: string; body: string }) => JSON.stringify([n.title, n.body]);

export type SaveState = "saving" | "saved" | "failed";

interface NotesValue {
  notes: Note[];
  loading: boolean;
  /** The list could not be loaded. */
  error: boolean;
  /** Some note text is not downloaded yet, so a search may not see all of it. */
  opening: boolean;
  reload: () => void;
  /** Downloads one note's text now, ahead of the rest. */
  ensureBody: (id: string) => Promise<void>;
  /** Starts loading a note's text and files, for a note about to be opened. */
  warm: (id: string) => void;
  /** Downloads every note's text, for searching. */
  ensureAllBodies: () => void;
  /** Rewrites an opened note that is still stored as plaintext or without an excerpt, sealed. */
  upgrade: (id: string) => Promise<void>;
  noteById: (id: string) => Note | undefined;
  saveState: (id: string) => SaveState | undefined;
  create: () => Promise<Note | null>;
  /** The text can be a function, read when the save is due. */
  edit: (id: string, fields: { title?: string; body?: string | (() => string) }) => void;
  /** Saves any change still waiting. */
  flush: (id: string) => Promise<boolean>;
  pin: (id: string, pinned: boolean) => void;
  /** Whether the AI is given this note with every draft. */
  draftWith: (id: string, on: boolean) => void;
  remove: (id: string) => Promise<void>;
  /** Called when a note is closed: drops it if it was left empty, and deletes files taken out of it. */
  close: (id: string, files: NoteFile[]) => void;
}

const NotesContext = createContext<NotesValue | null>(null);

// The notes as last loaded, for the user who loaded them, so reopening Notes shows them at once.
let cached: { userId: string; notes: Note[] } | null = null;

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const userRef = useRef(userId);
  userRef.current = userId;
  const own = userId && cached?.userId === userId ? cached.notes : null;
  const [notes, setNotes] = useState<Note[]>(() => own ?? []);
  const [loading, setLoading] = useState(own === null);
  const [error, setError] = useState(false);
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Pending "edited just now" updates for notes whose list-visible fields did not change.
  const bumps = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Notes changed since their last save, when each first changed, and the save running for each.
  const dirty = useRef(new Set<string>());
  const firstDirty = useRef(new Map<string, number>());
  const running = useRef(new Map<string, Promise<void>>());
  // Text still to be read from the editor, the newest text read from it, and what was last saved.
  const getters = useRef(new Map<string, () => string>());
  const latest = useRef(new Map<string, string>());
  const lastSaved = useRef(new Map<string, string>());
  const opening = useRef(new Map<string, Promise<void>>());

  const commit = useCallback((next: Note[] | ((prev: Note[]) => Note[])) => {
    setNotes((prev) => {
      const out = typeof next === "function" ? next(prev) : next;
      if (userRef.current) cached = { userId: userRef.current, notes: out };
      return out;
    });
  }, []);

  /** Reads the text waiting in the editor into the note. */
  const resolve = useCallback((id: string) => {
    const read = getters.current.get(id);
    if (!read) return;
    getters.current.delete(id);
    let body: string;
    try { body = read(); } catch { return; }
    latest.current.set(id, body);
    commit((prev) => prev.map((n) => (n.id === id ? { ...n, body } : n)));
  }, [commit]);

  /** The note as it stands now, including text read from the editor but not yet shown in state. */
  const current = useCallback((id: string): Note | undefined => {
    const note = notesRef.current.find((n) => n.id === id);
    const body = latest.current.get(id);
    return note && body !== undefined ? { ...note, body } : note;
  }, []);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setError(false);
    try {
      const rows = await loadNotes();
      if (isCancelled()) return;
      commit((prev) => {
        const before = new Map(prev.map((n) => [n.id, n]));
        return rows.map((row) => {
          const old = before.get(row.id);
          // Notes being edited are left as they are, and text already opened is not closed again.
          if (old && (dirty.current.has(row.id) || getters.current.has(row.id))) return old;
          latest.current.delete(row.id);
          if (old && !old.unloaded && old.updatedAt === row.updatedAt) {
            return { ...row, body: old.body, unloaded: false, excerpt: row.excerpt ?? noteExcerpt(old.body), stale: row.stale && old.stale };
          }
          return row;
        });
      });
    } catch {
      if (isCancelled()) return;
      setError(true);
      toast.error("Could not load your notes.");
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, [commit]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const reload = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Downloads and opens the text of these notes. A note that could not be had is marked failed, so the
  // background loop does not ask for it again.
  const ensureBodies = useCallback((ids: string[]): Promise<void> => {
    const waits: Promise<void>[] = [];
    const need: string[] = [];
    for (const id of ids) {
      const pending = opening.current.get(id);
      if (pending) waits.push(pending);
      else if (notesRef.current.find((n) => n.id === id)?.unloaded) need.push(id);
    }
    if (need.length > 0) {
      const run = loadNoteBodies(need)
        .then((bodies) => {
          commit((prev) => prev.map((n) => {
            if (!need.includes(n.id) || !n.unloaded) return n;
            const got = bodies.get(n.id);
            if (!got) return { ...n, failed: true };
            return { ...n, body: got.body, unloaded: false, failed: undefined, excerpt: n.excerpt ?? noteExcerpt(got.body), stale: n.stale || got.plain };
          }));
          for (const [id, got] of bodies) {
            const note = notesRef.current.find((n) => n.id === id);
            if (note && !dirty.current.has(id)) lastSaved.current.set(id, keyOf({ title: note.title, body: got.body }));
          }
        })
        .catch(() => { commit((prev) => prev.map((n) => (need.includes(n.id) && n.unloaded ? { ...n, failed: true } : n))); })
        .finally(() => { for (const id of need) opening.current.delete(id); });
      for (const id of need) opening.current.set(id, run);
      waits.push(run);
    }
    return Promise.all(waits).then(() => {});
  }, [commit]);

  const ensureBody = useCallback((id: string) => ensureBodies([id]), [ensureBodies]);
  const warm = useCallback((id: string) => {
    void ensureBodies([id]);
    prefetchNoteFiles(id);
  }, [ensureBodies]);

  // Once the list is in, the newest notes' text is fetched in one request.
  const warmed = useRef(false);
  useEffect(() => {
    if (loading || warmed.current || notes.length === 0) return;
    warmed.current = true;
    void ensureBodies(sortNotes(notes).slice(0, WARM_NEWEST).map((n) => n.id));
  }, [loading, notes, ensureBodies]);

  // The rest of the text is downloaded a few notes at a time: always for notes with no excerpt yet (the
  // list needs one), and for every note once a search wants them all.
  const wantAll = useRef(false);
  const bulk = useRef(false);
  const loadMore = useCallback(() => {
    if (bulk.current) return;
    bulk.current = true;
    const tried = new Set<string>();
    void (async () => {
      try {
        for (;;) {
          const next = notesRef.current.filter((n) => n.unloaded && !n.failed && !tried.has(n.id) && (wantAll.current || n.excerpt === null)).slice(0, OPEN_BATCH);
          if (next.length === 0) return;
          for (const n of next) tried.add(n.id);
          await ensureBodies(next.map((n) => n.id));
          await new Promise((r) => setTimeout(r, 30));
        }
      } finally {
        // Nothing awaits between the last check and here, so a request made now cannot be missed.
        bulk.current = false;
        wantAll.current = false;
      }
    })();
  }, [ensureBodies]);

  const ensureAllBodies = useCallback(() => {
    wantAll.current = true;
    loadMore();
  }, [loadMore]);

  const anyUnloaded = useMemo(() => notes.some((n) => n.unloaded && !n.failed), [notes]);
  const needsExcerpt = useMemo(() => notes.some((n) => n.unloaded && !n.failed && n.excerpt === null), [notes]);
  useEffect(() => {
    if (!loading && needsExcerpt) loadMore();
  }, [loading, needsExcerpt, loadMore]);

  /** Saves the note, resolving to false when the save failed (the note is then still changed). */
  const save = useCallback(async (id: string): Promise<boolean> => {
    resolve(id);
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    // A new note is saved only once its row exists.
    await noteReady(id).catch(() => {});
    // One save at a time per note; a change made during it is saved after.
    await running.current.get(id);
    resolve(id);
    if (!dirty.current.has(id)) return true;
    const note = current(id);
    if (!note) { dirty.current.delete(id); return true; }
    dirty.current.delete(id);
    firstDirty.current.delete(id);
    if (note.unloaded) return true;
    // Typing that ended where it began costs nothing.
    const key = keyOf(note);
    if (lastSaved.current.get(id) === key) {
      setStates((s) => ({ ...s, [id]: dirty.current.has(id) ? "saving" : "saved" }));
      return true;
    }
    setStates((s) => ({ ...s, [id]: "saving" }));
    let saved = true;
    const run = saveNote(id, { title: note.title, body: note.body })
      .then((updatedAt) => {
        lastSaved.current.set(id, key);
        if (!dirty.current.has(id)) commit((prev) => prev.map((n) => (n.id === id ? { ...n, updatedAt, stale: false } : n)));
        setStates((s) => ({ ...s, [id]: dirty.current.has(id) ? "saving" : "saved" }));
      })
      .catch(() => {
        saved = false;
        dirty.current.add(id);
        setStates((s) => ({ ...s, [id]: "failed" }));
      })
      .finally(() => running.current.delete(id));
    running.current.set(id, run);
    await run;
    return saved;
  }, [commit, resolve, current]);

  // A note stored as plaintext, or without an excerpt, is rewritten sealed when it is opened. The save
  // joins the note's queue, so a change typed meanwhile is saved after it.
  const upgrade = useCallback(async (id: string): Promise<void> => {
    const note = current(id);
    if (!note || !note.stale || note.unloaded || dirty.current.has(id) || running.current.has(id)) return;
    const key = keyOf(note);
    const run = saveNote(id, { title: note.title, body: note.body })
      .then((updatedAt) => {
        lastSaved.current.set(id, key);
        commit((prev) => prev.map((n) => (n.id === id ? { ...n, updatedAt: dirty.current.has(id) ? n.updatedAt : updatedAt, stale: false } : n)));
      })
      .catch(() => {})
      .finally(() => running.current.delete(id));
    running.current.set(id, run);
    await run;
  }, [commit, current]);

  // Leaving Notes, or the page, saves what is still waiting. Closing the tab with a save still to finish
  // asks first, so the change is not lost.
  useEffect(() => {
    const flushAll = () => { for (const id of dirty.current) void save(id); };
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current.size === 0 && running.current.size === 0) return;
      flushAll();
      e.preventDefault();
    };
    window.addEventListener("pagehide", flushAll);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      window.removeEventListener("beforeunload", warn);
      flushAll();
    };
  }, [save]);

  const edit = useCallback<NotesValue["edit"]>((id, fields) => {
    const { body, ...rest } = fields;
    if (typeof body === "function") getters.current.set(id, body);
    else if (body !== undefined) { getters.current.delete(id); latest.current.set(id, body); }
    // The list shows the title, excerpt and order, none of which move while only the editor's text changes (it is read
    // lazily). Committing then would re-sort and re-render every consumer per keystroke, so only a real change commits,
    // and the "edited" time catches up once typing pauses.
    const note = notesRef.current.find((n) => n.id === id);
    const shown = (Object.keys(rest) as (keyof typeof rest)[]).some((k) => note?.[k] !== rest[k]) || (typeof body === "string" && body !== note?.body);
    clearTimeout(bumps.current.get(id));
    if (shown) {
      const updatedAt = new Date().toISOString();
      commit((prev) => prev.map((n) => (n.id === id ? { ...n, ...rest, ...(typeof body === "string" ? { body } : {}), updatedAt } : n)));
    } else {
      bumps.current.set(id, setTimeout(() => {
        bumps.current.delete(id);
        const updatedAt = new Date().toISOString();
        commit((prev) => prev.map((n) => (n.id === id ? { ...n, updatedAt } : n)));
      }, BUMP_IDLE_MS));
    }
    dirty.current.add(id);
    setStates((s) => (s[id] === "saving" ? s : { ...s, [id]: "saving" }));
    // Saves once typing has paused, and in any case within the longest wait after the first change.
    const now = Date.now();
    const first = firstDirty.current.get(id) ?? now;
    firstDirty.current.set(id, first);
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(() => void save(id), Math.max(0, Math.min(SAVE_IDLE_MS, first + SAVE_MAX_MS - now))));
  }, [commit, save]);

  // The note opens at once; its row is written meanwhile, and if that fails the note is taken back out.
  const create = useCallback(async () => {
    const { note, saved } = createNote();
    lastSaved.current.set(note.id, keyOf(note));
    creating.set(note.id, saved);
    commit((prev) => [note, ...prev]);
    track("feature_used", { feature: "note_created" });
    saved.then(
      () => { creating.delete(note.id); },
      () => {
        creating.delete(note.id);
        dirty.current.delete(note.id);
        commit((prev) => prev.filter((n) => n.id !== note.id));
        toast.error("Could not create a note.");
      },
    );
    return note;
  }, [commit]);

  const pin = useCallback((id: string, pinned: boolean) => {
    commit((prev) => prev.map((n) => (n.id === id ? { ...n, pinned } : n)));
    noteReady(id).then(() => pinNote(id, pinned)).catch(() => {
      commit((prev) => prev.map((n) => (n.id === id ? { ...n, pinned: !pinned } : n)));
      toast.error(pinned ? "Could not pin the note." : "Could not unpin the note.");
    });
  }, [commit]);

  const draftWith = useCallback((id: string, on: boolean) => {
    commit((prev) => prev.map((n) => (n.id === id ? { ...n, useInDrafts: on } : n)));
    track("setting_changed", { setting: "note_use_in_drafts" });
    noteReady(id).then(() => useNoteInDrafts(id, on)).catch(() => {
      commit((prev) => prev.map((n) => (n.id === id ? { ...n, useInDrafts: !on } : n)));
      toast.error("Could not change whether drafts use the note.");
    });
  }, [commit]);

  const remove = useCallback(async (id: string) => {
    const note = current(id);
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    clearTimeout(bumps.current.get(id));
    bumps.current.delete(id);
    dirty.current.delete(id);
    firstDirty.current.delete(id);
    getters.current.delete(id);
    latest.current.delete(id);
    commit((prev) => prev.filter((n) => n.id !== id));
    try {
      await noteReady(id).catch(() => {});
      await running.current.get(id);
      // A save that failed meanwhile marks the note changed again; it is going, so nothing is left to save.
      dirty.current.delete(id);
      await deleteNote(id);
      track("feature_used", { feature: "note_deleted" });
    } catch {
      // Puts back only this note, so edits made to others meanwhile are kept.
      if (note) commit((prev) => (prev.some((n) => n.id === id) ? prev : [...prev, note]));
      toast.error("Could not delete the note.");
    }
  }, [commit, current]);

  const close = useCallback((id: string, files: NoteFile[]) => {
    resolve(id);
    const note = current(id);
    if (!note || note.unloaded) return;
    if (isBlankNote(note) && files.length === 0) {
      void remove(id);
      return;
    }
    const unused = unusedFiles(files, note.body);
    // Files are deleted only once the body without them is saved; offline, the saved body may still point at them.
    if (unused.length) void save(id).then((saved) => (saved ? removeNoteFiles(unused) : undefined)).catch(() => {});
  }, [remove, save, resolve, current]);

  const sorted = useMemo(() => sortNotes(notes), [notes]);
  const value = useMemo<NotesValue>(() => ({
    notes: sorted,
    loading,
    error,
    opening: anyUnloaded,
    reload,
    ensureBody,
    warm,
    ensureAllBodies,
    upgrade,
    noteById: (id) => notes.find((n) => n.id === id),
    saveState: (id) => states[id],
    create,
    edit,
    flush: save,
    pin,
    draftWith,
    remove,
    close,
  }), [sorted, notes, loading, error, anyUnloaded, reload, ensureBody, warm, ensureAllBodies, upgrade, states, create, edit, save, pin, draftWith, remove, close]);

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes() {
  const value = useContext(NotesContext);
  if (!value) throw new Error("useNotes needs a NotesProvider.");
  return value;
}

/** Makes a note and opens it in its title. */
export function useNewNote(onCreated?: () => void) {
  const { create } = useNotes();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const busy = useRef(false);
  const newNote = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setCreating(true);
    const note = await create();
    busy.current = false;
    setCreating(false);
    if (!note) return;
    onCreated?.();
    router.push(`/notes/${note.id}?new=1`);
  }, [create, router, onCreated]);
  return { creating, newNote };
}
