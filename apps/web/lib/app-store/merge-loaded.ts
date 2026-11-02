// Applies rows fetched from the database on top of the state as it is now, not as it was when the fetch began. A
// fetch takes a second or more; an archive, a pin, a realtime update or a task made meanwhile must survive it. Pure,
// so the reducer's "merged" action stays a one-liner and this can be tested without a store.

import { isTempTask } from "../tasks";
import type { Loaded } from "../data";
import type { Thread } from "../types";
import type { State } from "./reducer";

const same = (a: unknown, b: unknown) => Object.is(a, b) || (typeof a === "object" && a !== null && typeof b === "object" && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** Fetched values, except every field that changed between base and current: those were changed here after the fetch began. */
function keepLocalEdits<T extends object>(base: T, fetched: T, current: T): T {
  const out = { ...fetched } as Record<string, unknown>;
  for (const key of new Set([...Object.keys(base), ...Object.keys(current)])) {
    const was = (base as Record<string, unknown>)[key];
    const now = (current as Record<string, unknown>)[key];
    if (!same(was, now)) out[key] = now;
  }
  return out as T;
}

/**
 * A list of rows with an id, fetched, merged with what happened to the held list meanwhile: a row removed here stays
 * removed, a row changed here keeps its local fields, a row added here is kept, and a row that is gone from the
 * fetch (deleted elsewhere) goes. keepAlways names rows that exist only here (a task not yet stored).
 */
export function mergeById<T extends { id: string }>(base: T[], fetched: T[], current: T[], opts: { addedFirst?: boolean; keepAlways?: (row: T) => boolean } = {}): T[] {
  const was = new Map(base.map((r) => [r.id, r]));
  const now = new Map(current.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of fetched) {
    seen.add(row.id);
    const before = was.get(row.id);
    const held = now.get(row.id);
    if (before && !held) continue; // removed here while the fetch ran
    out.push(before && held ? keepLocalEdits(before, row, held) : held && !before ? held : row);
  }
  const extra = current.filter((r) => !seen.has(r.id) && (!was.has(r.id) || opts.keepAlways?.(r)));
  return opts.addedFirst ? [...extra, ...out] : [...out, ...extra];
}

const newestFirst = (a: Thread, b: Thread) => (a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0);

/**
 * The state with a load's rows applied. base is the state when the fetch began, current the state now. Contacts are
 * merged by the reducer itself, as they are only ever added to.
 */
export function mergeLoaded(base: State, current: State, data: Omit<Loaded, "contactsLoaded" | "contacts">): Pick<State, "threads" | "accounts" | "rules" | "writingExamples" | "profile" | "unsubscribes" | "tasks"> {
  return {
    threads: mergeById(base.threads, data.threads, current.threads).sort(newestFirst),
    accounts: mergeById(base.accounts, data.accounts, current.accounts),
    rules: mergeById(base.rules, data.rules, current.rules, { addedFirst: true }),
    writingExamples: mergeById(base.writingExamples, data.writingExamples, current.writingExamples, { addedFirst: true }),
    unsubscribes: mergeById(base.unsubscribes, data.unsubscribes, current.unsubscribes),
    profile: keepLocalEdits(base.profile, data.profile, current.profile),
    tasks: mergeById(base.tasks, data.tasks, current.tasks, { keepAlways: isTempTask }),
  };
}
