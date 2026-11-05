// A stand-in for the app store (lib/store.tsx) built from plain fixture data, for screen tests. Reads come from the
// fixtures; every action is a recorded spy (node:test mock.fn) that does nothing, so a test asserts what the screen
// asked for ("Send was called with this text") and no database is ever involved.

import { mock, type Mock } from "node:test";
import type { ReactNode } from "react";
import { AppContext, type Ctx } from "@/lib/app-store/context";
import { listThreadsFor } from "@/lib/app-store/selectors";
import { initial } from "@/lib/app-store/reducer";
import type { LabelsApi } from "@/lib/app-store/use-labels";
import type { Label } from "@/lib/labels";
import type { Account, Contact, Message, Profile, Task, Thread } from "@/lib/types";
import { ACCOUNT, LABELS, PEOPLE, THREADS } from "./fixtures";

export interface FakeStoreData {
  threads?: Thread[];
  contacts?: Contact[];
  /** Loaded messages; conversations with none count as not loaded unless listed in loaded. */
  messages?: Message[];
  loaded?: string[];
  accounts?: Account[];
  tasks?: Task[];
  profile?: Partial<Profile>;
  labels?: Label[];
  /** The labels each conversation wears, by id. */
  wearing?: Record<string, string[]>;
  /** Anything else on the store a test needs to set (a spy with its own reply, drafting state, hydrated). */
  overrides?: Partial<Ctx>;
}

type Fn = (...args: never[]) => unknown;
/** Every function on the store, as the spy that stands in for it. */
export type StoreSpies = { [K in keyof Ctx as Ctx[K] extends Fn ? K : never]: Ctx[K] extends Fn ? Mock<Ctx[K]> : never };

/** A spy that records its calls and answers with `value` (wrapped in a promise when async). */
const spy = <F extends Fn>(impl: F) => mock.fn(impl);
const resolves = <T,>(value: T) => () => Promise.resolve(value);

/**
 * A labels API over fixture labels and who wears them, every method a spy. The store uses one by default; a test that
 * asserts on label changes makes its own and passes it as `overrides: { labels }`, so it holds the spies.
 */
export function spyLabels(labels: Label[] = LABELS, wearing: Record<string, string[]> = {}) {
  const byId = new Map(labels.map((l) => [l.id, l]));
  return {
    labels,
    labelsOf: mock.fn((threadId: string) => (wearing[threadId] ?? []).map((id) => byId.get(id)).filter((l): l is Label => !!l)),
    threadsWith: mock.fn((labelId: string) => new Set(Object.keys(wearing).filter((t) => wearing[t].includes(labelId)))),
    allWear: mock.fn((ids: string[], labelId: string) => ids.every((t) => (wearing[t] ?? []).includes(labelId))),
    createLabel: mock.fn(async (name: string): Promise<Label | null> => ({ id: `label-${name.toLowerCase()}`, name, color: "gray" })),
    updateLabel: mock.fn(async (_id: string, _patch: { name?: string; color?: Label["color"] }): Promise<boolean> => true),
    deleteLabel: mock.fn((_id: string) => undefined),
    setLabel: mock.fn((_ids: string[], _labelId: string, _on: boolean) => undefined),
  } satisfies LabelsApi;
}

/** A complete store value from fixtures. The default holds the shared fixture inbox, read and loaded. */
export function fakeStore(data: FakeStoreData = {}): { value: Ctx; spies: StoreSpies } {
  const threads = data.threads ?? THREADS;
  const contacts = data.contacts ?? PEOPLE;
  const messages = data.messages ?? [];
  const byThread = new Map<string, Message[]>();
  for (const m of messages) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);
  const loaded = new Set([...byThread.keys(), ...(data.loaded ?? [])]);
  const none: Message[] = [];
  const done = () => undefined;
  const value: Ctx = {
    ...initial, loading: false, threads, contacts, accounts: data.accounts ?? [ACCOUNT], tasks: data.tasks ?? [],
    profile: { ...initial.profile, name: "Sam Example", ...data.profile },
    dispatch: spy(done),
    contactById: spy((id: string) => contacts.find((c) => c.id === id)),
    threadById: spy((id: string) => threads.find((t) => t.id === id)),
    messages, messagesByThread: byThread,
    messagesFor: spy((id: string) => byThread.get(id) ?? none),
    messagesLoaded: spy((id: string) => loaded.has(id)),
    messagesFailed: spy(() => false),
    loadMessages: spy(resolves(undefined)),
    loadOlderMessages: spy(resolves(false)),
    hasOlder: spy(() => false),
    removePending: spy(done),
    retryPending: spy(resolves(true)),
    prefetchMessages: spy(resolves(undefined)),
    // The real filter and sort, so a list test sees what the app would show for a view and filter.
    listThreads: spy((view, filter) => listThreadsFor(threads, `${view}:${filter}`)),
    notify: spy(done), markRead: spy(done), archive: spy(done), unarchive: spy(done), trash: spy(done), pin: spy(done),
    restore: spy(resolves(true)), snooze: spy(done), unsnooze: spy(done), snoozeClock: 0,
    labels: spyLabels(data.labels ?? [], data.wearing ?? {}),
    send: spy(resolves(true)), cancelScheduled: spy(resolves(true)), sendScheduledNow: spy(resolves(true)),
    replyTo: {}, setReplyTo: spy(done), react: spy(done),
    composeEmail: spy(resolves("outbox-new")), composeWhatsApp: spy(resolves("outbox-new")),
    generateComposeDraft: spy(resolves("compose-draft")), composeDrafts: {}, discardComposeDraft: spy(done),
    composed: {}, refreshCompose: spy(resolves(undefined)), ensureThread: spy(resolves(true)),
    saveSendAddresses: spy(resolves(true)), generateDraft: spy(resolves(undefined)), discardDraft: spy(done),
    requestAutoDraft: spy(resolves(undefined)), setJunk: spy(done), unsubscribe: spy(resolves(0)), confirmUnsubscribe: spy(done),
    drafting: {}, draftText: {}, hydrated: true, giveFeedback: spy(done),
    mergeContacts: spy(resolves("merge-1")), splitContact: spy(resolves("contact-new")), undoMerge: spy(resolves(true)),
    patchContact: spy(done), removeContact: spy(done), contactChanges: [], contactsRefreshed: 0,
    refreshContacts: spy(resolves(contacts)), contactsVersion: 0, contactsReady: true,
    tickTask: spy(done), createTask: spy(done), editTask: spy(done), deleteTask: spy(done),
    ...data.overrides,
  };
  const spies = Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "function")) as StoreSpies;
  return { value, spies };
}

/** Puts a fake store where useApp() finds it. */
export function FakeStore({ store, children }: { store: Ctx; children: ReactNode }) {
  return <AppContext.Provider value={store}>{children}</AppContext.Provider>;
}

/** The arguments of each call to a spy (a store spy or a labels one), oldest first. */
export const argsOf = (fn: unknown) => (fn as Mock<Fn>).mock.calls.map((c) => c.arguments as unknown[]);
