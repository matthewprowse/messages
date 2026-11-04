// What goes into the device copy of the inbox (sealed-copy.ts) and how it comes back into the store. Pure: no storage,
// no crypto, no network. The copy is the list, the people it names and the small tables; message bodies never go in.
// On the way back, anything the store already holds live wins over the copy, and the network load later wins over both
// (see "copied" in app-store/reducer.ts and showCopy in use-local-copy.ts).

import { isTempTask } from "../tasks";
import type { Thread } from "../types";
import type { State } from "../app-store/reducer";
import type { CopyData } from "./sealed-copy";

/** The people a list of conversations and tasks names: participants, the last sender and a task's client. */
function namedIn(threads: Thread[], tasks: CopyData["tasks"]): Set<string> {
  const ids = new Set<string>();
  for (const t of threads) {
    for (const id of t.participantIds) ids.add(id);
    if (t.lastSenderId) ids.add(t.lastSenderId);
  }
  for (const t of tasks) if (t.contactId) ids.add(t.contactId);
  return ids;
}

/**
 * The store as it is worth keeping on the device: conversations not in the bin, only the contacts they name (the rest
 * load with the list), and tasks already stored (one still being made would come back as a phantom).
 */
export function snapshotOf(s: State): CopyData {
  const threads = s.threads.filter((t) => t.status !== "trash");
  const tasks = s.tasks.filter((t) => !isTempTask(t));
  const named = namedIn(threads, tasks);
  return {
    threads, contacts: s.contacts.filter((c) => named.has(c.id)), tasks,
    accounts: s.accounts, rules: s.rules, writingExamples: s.writingExamples, profile: s.profile, unsubscribes: s.unsubscribes,
  };
}

/** The copy cut to its newest `keep` conversations (the list is newest first) and the contacts those still name. */
export function trimCopy(data: CopyData, keep: number): CopyData {
  const threads = [...data.threads].sort(newestFirst).slice(0, keep);
  const named = namedIn(threads, data.tasks);
  return { ...data, threads, contacts: data.contacts.filter((c) => named.has(c.id)) };
}

const newestFirst = (a: Thread, b: Thread) => (a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0);

/** Rows held live, then the copy's rows that are not. */
function fill<T extends { id: string }>(live: T[], copied: T[]): T[] {
  if (live.length === 0) return copied;
  const held = new Set(live.map((r) => r.id));
  return [...live, ...copied.filter((r) => !held.has(r.id))];
}

/**
 * The state with the device copy laid under it. Rows already held (a realtime change that beat the copy) win; the
 * copy fills in the rest. The profile comes from the copy unless one has been loaded or edited already.
 */
export function withCopy(s: State, copy: CopyData, emptyProfile: State["profile"]): Pick<State, "threads" | "contacts" | "accounts" | "rules" | "writingExamples" | "profile" | "unsubscribes" | "tasks"> {
  return {
    threads: fill(s.threads, copy.threads).sort(newestFirst),
    contacts: fill(s.contacts, copy.contacts),
    accounts: fill(s.accounts, copy.accounts),
    rules: fill(s.rules, copy.rules),
    writingExamples: fill(s.writingExamples, copy.writingExamples),
    profile: s.profile === emptyProfile ? copy.profile : s.profile,
    unsubscribes: fill(s.unsubscribes, copy.unsubscribes),
    tasks: fill(s.tasks, copy.tasks),
  };
}
