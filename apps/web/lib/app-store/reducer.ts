// The app state (threads, messages, contacts, accounts, rules, tasks) and the reducer that applies every change to it.


import type { Tables } from "@messages/db";
import type { Account, Attachment, Contact, Draft, Message, Priority, Profile, Rule, Task, Thread, Unsubscribe, WritingExample } from "../types";
import {
  EMPTY_PROFILE, leadParticipant, mapAttachment, patchMessage, type Loaded, 
} from "../data";

export interface State {
  loading: boolean;
  threads: Thread[];
  /** Loaded messages by conversation, oldest first. */
  byThread: Record<string, Message[]>;
  contacts: Contact[];
  accounts: Account[];
  rules: Rule[];
  writingExamples: WritingExample[];
  profile: Profile;
  unsubscribes: Unsubscribe[];
  /** Tasks with a due date, for Calendar and the Summary. */
  tasks: Task[];
}

export type Action =
  | { type: "loaded"; data: Loaded }
  | { type: "clear" }
  | { type: "upsertThread"; thread: Thread }
  | { type: "removeThread"; id: string }
  | { type: "patchThread"; id: string; patch: Partial<Thread> }
  | { type: "patchThreads"; ids: string[]; patch: Partial<Thread> }
  | { type: "setThreadMessages"; threadId: string; messages: Message[] }
  | { type: "mergeMessages"; threadId: string; messages: Message[] }
  | { type: "addMessage"; message: Message }
  | { type: "replaceMessage"; message: Message }
  | { type: "patchMessage"; threadId: string; id: string; row: { provider_meta?: unknown; body_text?: string | null; transcript?: string | null } }
  | { type: "upsertAttachment"; row: Tables<"attachments"> }
  | { type: "removeAttachment"; id: string }
  | { type: "upsertContacts"; contacts: Contact[] }
  | { type: "setDraft"; id: string; draft?: Draft }
  | { type: "feedback"; id: string; value: "important" | "not_important" }
  | { type: "upsertUnsubscribe"; unsubscribe: Unsubscribe }
  | { type: "removeUnsubscribe"; id: string }
  | { type: "upsertAccount"; account: Account }
  | { type: "patchAccount"; id: string; patch: Partial<Account> }
  | { type: "addRule"; rule: Rule }
  | { type: "removeRule"; id: string }
  | { type: "addExample"; example: WritingExample }
  | { type: "removeExample"; id: string }
  | { type: "patchProfile"; patch: Partial<Profile> }
  | { type: "setContactGraph"; contacts: Contact[]; participants: Map<string, string[]> }
  | { type: "upsertTask"; task: Task }
  | { type: "removeTask"; id: string }
  | { type: "patchTask"; id: string; patch: Partial<Task> }
  | { type: "reset" };

export const initial: State = {
  loading: true,
  threads: [],
  byThread: {},
  contacts: [],
  accounts: [],
  rules: [],
  writingExamples: [],
  profile: EMPTY_PROFILE,
  unsubscribes: [],
  tasks: [],
};

export const byTime = (a: Message, b: Message) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Messages added to a conversation's list, or replacing the ones with the same id, kept in order. */
export function withMessages(list: Message[] = [], incoming: Message[]): Message[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(byTime);
}

export const sameContact = (a: Contact, b: Contact) =>
  a.name === b.name && a.company === b.company && a.role === b.role && a.avatarPath === b.avatarPath && a.isCompany === b.isCompany &&
  a.organization?.id === b.organization?.id && a.organization?.name === b.organization?.name &&
  a.organization?.logoPath === b.organization?.logoPath &&
  a.emails.join() === b.emails.join() && a.phones.join() === b.phones.join();

/** The list with these contacts added or updated. The same array when nothing changed, so lookups built on it stay stable. */
export function withContacts(list: Contact[], incoming: Contact[]): Contact[] {
  if (list.length === 0) return incoming;
  const byId = new Map(list.map((c) => [c.id, c]));
  let changed = false;
  for (const c of incoming) {
    const old = byId.get(c.id);
    if (old && sameContact(old, c)) continue;
    byId.set(c.id, c);
    changed = true;
  }
  return changed ? [...byId.values()] : list;
}

/** Changes one message's files wherever that message is loaded. */
export function editFiles(s: State, messageId: string | null, edit: (files: Attachment[]) => Attachment[]): State {
  for (const [threadId, list] of Object.entries(s.byThread)) {
    const i = messageId ? list.findIndex((m) => m.id === messageId) : list.findIndex((m) => m.attachments?.length && edit(m.attachments) !== m.attachments);
    if (i < 0) continue;
    const before = list[i].attachments ?? [];
    const after = edit(before);
    if (after === before) return s;
    const next = [...list];
    next[i] = { ...list[i], attachments: after.length ? after : undefined };
    return { ...s, byThread: { ...s.byThread, [threadId]: next } };
  }
  return s;
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "loaded":
      // Contacts are merged, as a resync after a reconnect brings only the people in the listed threads.
      return { ...s, ...a.data, contacts: withContacts(s.contacts, a.data.contacts), loading: false };
    case "clear":
      return { ...initial, loading: false };
    case "upsertThread": {
      const exists = s.threads.some((t) => t.id === a.thread.id);
      return {
        ...s,
        threads: exists
          ? s.threads.map((t) => (t.id === a.thread.id ? { ...t, ...a.thread, draft: t.draft, feedback: t.feedback } : t))
          : [a.thread, ...s.threads],
      };
    }
    case "removeThread":
      return { ...s, threads: s.threads.filter((t) => t.id !== a.id) };
    case "patchThread":
      return { ...s, threads: s.threads.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) };
    case "patchThreads": {
      const ids = new Set(a.ids);
      return { ...s, threads: s.threads.map((t) => (ids.has(t.id) ? { ...t, ...a.patch } : t)) };
    }
    case "setThreadMessages":
      return { ...s, byThread: { ...s.byThread, [a.threadId]: [...a.messages].sort(byTime) } };
    case "mergeMessages":
      return { ...s, byThread: { ...s.byThread, [a.threadId]: withMessages(s.byThread[a.threadId], a.messages) } };
    case "addMessage":
      if (s.byThread[a.message.threadId]?.some((m) => m.id === a.message.id)) return s;
      return { ...s, byThread: { ...s.byThread, [a.message.threadId]: withMessages(s.byThread[a.message.threadId], [a.message]) } };
    case "replaceMessage":
      return { ...s, byThread: { ...s.byThread, [a.message.threadId]: withMessages(s.byThread[a.message.threadId], [a.message]) } };
    case "patchMessage": {
      const list = s.byThread[a.threadId];
      const i = list?.findIndex((m) => m.id === a.id) ?? -1;
      if (i < 0) return s;
      const patched = patchMessage(list[i], a.row);
      if (patched === list[i]) return s;
      const next = [...list];
      next[i] = patched;
      return { ...s, byThread: { ...s.byThread, [a.threadId]: next } };
    }
    case "upsertAttachment": {
      const file = mapAttachment(a.row);
      const hidden = a.row.hidden;
      return editFiles(s, a.row.message_id, (files) => {
        const at = files.findIndex((f) => f.id === file.id);
        if (hidden) return at < 0 ? files : files.filter((f) => f.id !== file.id);
        return at < 0 ? [...files, file] : files.map((f) => (f.id === file.id ? { ...f, ...file } : f));
      });
    }
    case "removeAttachment":
      return editFiles(s, null, (files) => (files.some((f) => f.id === a.id) ? files.filter((f) => f.id !== a.id) : files));
    case "upsertContacts": {
      const contacts = withContacts(s.contacts, a.contacts);
      return contacts === s.contacts ? s : { ...s, contacts };
    }
    case "setDraft":
      return { ...s, threads: s.threads.map((t) => (t.id === a.id ? { ...t, draft: a.draft } : t)) };
    case "feedback": {
      const priority: Priority = a.value === "important" ? "important" : "low";
      return { ...s, threads: s.threads.map((t) => (t.id === a.id ? { ...t, feedback: a.value, priority } : t)) };
    }
    case "upsertUnsubscribe":
      return {
        ...s,
        unsubscribes: [...s.unsubscribes.filter((u) => u.id !== a.unsubscribe.id && u.sender !== a.unsubscribe.sender), a.unsubscribe],
      };
    case "removeUnsubscribe":
      return { ...s, unsubscribes: s.unsubscribes.filter((u) => u.id !== a.id) };
    case "upsertAccount":
      return s.accounts.some((x) => x.id === a.account.id)
        ? { ...s, accounts: s.accounts.map((x) => (x.id === a.account.id ? a.account : x)) }
        : { ...s, accounts: [...s.accounts, a.account] };
    case "patchAccount":
      return { ...s, accounts: s.accounts.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case "addRule":
      return { ...s, rules: [a.rule, ...s.rules] };
    case "removeRule":
      return { ...s, rules: s.rules.filter((r) => r.id !== a.id) };
    case "addExample":
      return { ...s, writingExamples: [a.example, ...s.writingExamples] };
    case "removeExample":
      return { ...s, writingExamples: s.writingExamples.filter((w) => w.id !== a.id) };
    case "patchProfile":
      return { ...s, profile: { ...s.profile, ...a.patch } };
    case "setContactGraph":
      return { ...s, contacts: a.contacts, threads: s.threads.map((t) => ({ ...t, participantIds: leadParticipant(a.participants.get(t.id) ?? [], t.lastSenderId) })) };
    case "upsertTask": {
      // A task that lost its date has no day to show on.
      const others = s.tasks.filter((t) => t.id !== a.task.id);
      return { ...s, tasks: a.task.dueAt ? [...others, a.task] : others };
    }
    case "removeTask":
      return s.tasks.some((t) => t.id === a.id) ? { ...s, tasks: s.tasks.filter((t) => t.id !== a.id) } : s;
    case "patchTask":
      return { ...s, tasks: s.tasks.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) };
    case "reset":
      return s; // not available on real data yet
  }
}
