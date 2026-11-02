// Small caches for the app store's derived data (store.tsx), so a change to one part of the state does not redo work for another.


/** Remembers the last result of a one-argument function: the same input reference gives the same output reference. */
export function memoLast<A, R>(fn: (a: A) => R): (a: A) => R {
  let has = false;
  let last: A;
  let out: R;
  return (a) => {
    if (!has || last !== a) { out = fn(a); last = a; has = true; }
    return out;
  };
}

/**
 * Results per key for one source array, dropped as soon as the source is a different array (the store replaces
 * the threads array on any change). Keys that depend on the clock must not be cached: pass cacheable false.
 */
export function perSource<S, R>(compute: (source: S, key: string) => R) {
  let src: S | undefined;
  let results = new Map<string, R>();
  return (source: S, key: string, cacheable = true): R => {
    if (!cacheable) return compute(source, key);
    if (src !== source) { src = source; results = new Map(); }
    let hit = results.get(key);
    if (hit === undefined) { hit = compute(source, key); results.set(key, hit); }
    return hit;
  };
}
