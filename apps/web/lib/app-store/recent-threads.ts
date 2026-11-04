// Which conversations keep their loaded messages. Messages are held per conversation and used to only grow while the
// app stayed open; this keeps the most recently used ones and names the rest to drop, ones loaded ahead of being opened
// first. Pure: the store acts on the answer.

/** Conversations whose messages are held at once. */
export const MAX_HELD_THREADS = 60;
/** After a reconnect, only this many of the most recently used conversations are brought up to date; the rest reload when opened. */
export const CATCH_UP_THREADS = 12;

/**
 * Marks a conversation as just used. order runs oldest to newest. Returns the new order and the conversations to drop,
 * oldest first; keep (the open conversation) and the one just used are never dropped.
 */
export function touchHeld(order: readonly string[], id: string, keep: string | null, cap = MAX_HELD_THREADS): { order: string[]; evict: string[] } {
  const next = order.filter((x) => x !== id);
  next.push(id);
  const evict: string[] = [];
  for (let i = 0; next.length > cap && i < next.length - 1;) {
    if (next[i] === keep) { i++; continue; }
    evict.push(next[i]);
    next.splice(i, 1);
  }
  return { order: next, evict };
}

/**
 * Holds a conversation loaded ahead of being opened (a hover, a press, the idle prefetch). `prefetched` names the held
 * ones that were loaded that way and not opened since. A guess must never cost a conversation you used, so it goes in
 * behind the other guesses and ahead of every opened one (the order's oldest end, where touchHeld drops first), and past
 * the cap only older guesses are dropped. With no guess left to drop it is dropped itself (evict then names `id`).
 * Already held, nothing moves.
 */
export function holdPrefetched(order: readonly string[], id: string, keep: string | null, prefetched: ReadonlySet<string>, cap = MAX_HELD_THREADS): { order: string[]; evict: string[] } {
  if (order.includes(id)) return { order: [...order], evict: [] };
  const next = [...order];
  let at = 0;
  while (at < next.length && prefetched.has(next[at])) at++;
  next.splice(at, 0, id);
  const evict: string[] = [];
  for (let i = 0; next.length > cap && i < next.length;) {
    const x = next[i];
    if (x === id || x === keep || !prefetched.has(x)) { i++; continue; }
    evict.push(x);
    next.splice(i, 1);
  }
  if (next.length > cap) return { order: next.filter((x) => x !== id), evict: [...evict, id] };
  return { order: next, evict };
}

/** Whether a prefetch could be held without dropping an opened conversation: there is room, or an older guess to give up. */
export function roomToPrefetch(order: readonly string[], keep: string | null, prefetched: ReadonlySet<string>, cap = MAX_HELD_THREADS): boolean {
  return order.length < cap || order.some((x) => x !== keep && prefetched.has(x));
}

/** The conversations to catch up after a reconnect: the open one, then the newest used, at most limit in all. */
export function catchUpSet(order: readonly string[], open: string | null, limit = CATCH_UP_THREADS): string[] {
  const held = !!open && order.includes(open);
  const recent = order.filter((x) => x !== open).slice(-Math.max(0, limit - (held ? 1 : 0)));
  return held ? [open as string, ...recent] : recent;
}
