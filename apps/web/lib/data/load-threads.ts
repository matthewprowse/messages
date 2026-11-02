// Loads the conversation list for the signed-in user: everything at start up, what changed after a dropped connection,
// and one new conversation. Row-level security keeps these to the user's own rows, with one exception: a team's work
// chats can also be read by whoever they are assigned to, and by Compliance under strict sharing
// (supabase/migrations/20261101120000). A list of chats asks for the user's own with user_id, so a colleague's chat
// never lands in someone's inbox.

import { openThreads } from "../open-rows";
import { supabase } from "../supabase";
import type { Account, Contact, Profile, Rule, Task, Thread, Unsubscribe, WritingExample } from "../types";
import { whenPhoneFormatReady } from "../format";
import { mergeThreads } from "../merge-threads";
import { THREAD_WITH_IDS, THREAD_WITH_PEOPLE } from "./columns";
import { threadWithIds, threadWithPeople } from "./map-thread";
import { loadContacts } from "./load-contacts";
import { loadSmall, myId } from "./load-small";

export interface Loaded {
  threads: Thread[];
  /** Every contact, from one loadContacts. Empty when that failed, and the store then retries it (see store.tsx). */
  contacts: Contact[];
  /** Whether contacts holds everyone. False when loading them failed, which the store then retries. */
  contactsLoaded: boolean;
  accounts: Account[];
  rules: Rule[];
  writingExamples: WritingExample[];
  profile: Profile;
  unsubscribes: Unsubscribe[];
  /** Tasks with a due date: every open one, and completed ones due in the last TASK_DAYS days or later. */
  tasks: Task[];
}

/** A deliberate product cap: the list holds the newest 1000 conversations. Older ones are not loaded and nothing searches them. */
const THREAD_LIMIT = 1000;
/** The most conversations a catch-up after a dropped connection reads; more than that and everything is reloaded. */
const CHANGE_LIMIT = 200;

/** Everything the list screens need, in parallel. Messages load per conversation when it is opened. */
export async function loadEverything(): Promise<Loaded> {
  const me = await myId();
  // Independent of the queries, so it loads beside them instead of after.
  const phoneReady = whenPhoneFormatReady();
  const [threads, small, contacts] = await Promise.all([
    // Deleted conversations (in the provider's bin) are never shown, so they are not loaded.
    supabase.from("threads").select(THREAD_WITH_IDS).eq("user_id", me).neq("status", "trash")
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(THREAD_LIMIT),
    loadSmall(),
    // Not required: without them names are missing until the store tries again, but the list still opens.
    loadContacts().catch(() => null),
  ]);
  if (threads.error) throw threads.error;
  await Promise.all([openThreads(threads.data ?? []), phoneReady]);
  const { draftOf, waiting, ...rest } = small;
  return {
    threads: (threads.data ?? []).map((t) => ({ ...threadWithIds(t), draft: draftOf.get(t.id), waiting: waiting.has(t.id) })),
    contacts: contacts ?? [],
    contactsLoaded: !!contacts,
    ...rest,
  };
}

/**
 * What changed since a time, for catching up after a short dropped connection: the conversations updated since
 * (with their people) merged into the ones held, and the small tables again. Does not see a conversation deleted
 * for good in the meantime, so a long gap reloads everything instead. Throws when it cannot say, such as when more
 * than a page changed.
 */
export async function loadChanges(since: string, current: Thread[]): Promise<Loaded> {
  const me = await myId();
  const [changed, small] = await Promise.all([
    // Trash is included, so a conversation moved to the bin leaves the list.
    supabase.from("threads").select(THREAD_WITH_PEOPLE).eq("user_id", me).gt("updated_at", since).order("updated_at").limit(CHANGE_LIMIT),
    loadSmall(),
  ]);
  if (changed.error) throw changed.error;
  if ((changed.data?.length ?? 0) >= CHANGE_LIMIT) throw new Error("Too many changes to catch up");
  await openThreads(changed.data ?? []);
  await whenPhoneFormatReady();
  const contacts = new Map<string, Contact>();
  const rows = changed.data ?? [];
  const threads = rows.map((t) => threadWithPeople(t, contacts));
  const gone = new Set(rows.filter((t) => t.status === "trash").map((t) => t.id));
  const { draftOf, waiting, ...rest } = small;
  return {
    threads: mergeThreads(current, threads, gone).map((t) => ({ ...t, draft: draftOf.get(t.id), waiting: waiting.has(t.id) })),
    contacts: [...contacts.values()],
    contactsLoaded: false,
    ...rest,
  };
}

/** One conversation with its people, for one that has only just been created. */
export async function loadThread(threadId: string): Promise<{ thread: Thread; contacts: Contact[] } | null> {
  const { data, error } = await supabase.from("threads").select(THREAD_WITH_PEOPLE).eq("id", threadId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await openThreads([data]);
  await whenPhoneFormatReady();
  const contacts = new Map<string, Contact>();
  const thread = threadWithPeople(data, contacts);
  return { thread, contacts: [...contacts.values()] };
}
