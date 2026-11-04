// A small in-memory cache for stale-while-revalidate screens: a page shows what it last loaded at once and loads again
// underneath when that is old. Loads of one key share a single request, so two parts mounting together read once.
// Memory only, never storage: what is kept here is often decrypted. Every cache made here is emptied on sign out
// (clearMemoryCaches, called by lib/auth.tsx), so keys need not carry the user, though most do to be safe.

type Entry<T> = { value: T; at: number; version: number };

export interface MemoryCache<T> {
  /** The value kept for this key, fresh or not. */
  get(key: string): T | undefined;
  /** How long ago the value was loaded or set, in ms; Infinity when there is none or it was marked stale. */
  age(key: string): number;
  /** Stores a value as just loaded. */
  set(key: string, value: T): void;
  /** Changes a kept value (an edit, a Realtime change) without making it look newer. Does nothing when there is none. */
  patch(key: string, change: (value: T) => T): void;
  /** Keeps the value on screen but makes the next load read again. Without a key, every value. */
  invalidate(key?: string): void;
  delete(key: string): void;
  clear(): void;
  keys(): string[];
  /**
   * The kept value when it is younger than maxAgeMs, else a load. A load already on its way for the key is shared. A
   * value set while the load was out (an edit) wins over what the load brings back, and a load that outlives a clear
   * stores nothing. Rejects when the load does.
   */
  load(key: string, fetch: () => Promise<T>, maxAgeMs?: number): Promise<T>;
  /** Called after any change, for useSyncExternalStore. */
  subscribe(listener: () => void): () => void;
}

const all = new Set<{ clear: () => void }>();
const clearers = new Set<() => void>();

/** Empties every memory cache. Called on sign out so nothing decrypted outlives the session. */
export function clearMemoryCaches() {
  for (const cache of all) cache.clear();
  for (const clear of clearers) clear();
}

/** Registers module state kept outside these caches (a hand-rolled store) to be emptied on sign out too. */
export function onClearMemory(clear: () => void) {
  clearers.add(clear);
}

/** A cache holding at most `max` keys; the least recently stored goes first. `now` is for tests. */
export function createMemoryCache<T>({ max = 50, now = Date.now }: { max?: number; now?: () => number } = {}): MemoryCache<T> {
  const entries = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();
  const listeners = new Set<() => void>();
  let epoch = 0; // goes up on clear, so a load started before it is dropped
  let versions = 0;
  const emit = () => { for (const l of listeners) l(); };

  const store = (key: string, value: T, at: number) => {
    entries.delete(key);
    entries.set(key, { value, at, version: ++versions });
    while (entries.size > max) entries.delete(entries.keys().next().value as string);
    emit();
  };

  const cache: MemoryCache<T> = {
    get: (key) => entries.get(key)?.value,
    age: (key) => {
      const e = entries.get(key);
      return e && e.at > 0 ? Math.max(0, now() - e.at) : Infinity;
    },
    set: (key, value) => store(key, value, now()),
    patch: (key, change) => {
      const e = entries.get(key);
      if (!e) return;
      entries.set(key, { value: change(e.value), at: e.at, version: ++versions });
      emit();
    },
    invalidate: (key) => {
      for (const [k, e] of entries) if (key === undefined || k === key) e.at = 0;
    },
    delete: (key) => { if (entries.delete(key)) emit(); },
    clear: () => {
      epoch++;
      entries.clear();
      inflight.clear();
      emit();
    },
    keys: () => [...entries.keys()],
    load: (key, fetch, maxAgeMs = 0) => {
      const held = entries.get(key);
      if (held && cache.age(key) < maxAgeMs) return Promise.resolve(held.value);
      const pending = inflight.get(key);
      if (pending) return pending;
      const started = epoch;
      const before = held?.version;
      const run = fetch().then(
        (value) => {
          if (started !== epoch) return value;
          inflight.delete(key);
          const current = entries.get(key);
          // Something was stored meanwhile (an edit made while the load was out): it is newer than the load.
          if (current && current.version !== before) return current.value;
          store(key, value, now());
          return value;
        },
        (err) => {
          if (started === epoch) inflight.delete(key);
          throw err;
        },
      );
      inflight.set(key, run);
      return run;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  all.add(cache);
  return cache;
}
