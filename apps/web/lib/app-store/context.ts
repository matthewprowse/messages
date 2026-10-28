// The React context and the type of everything the app store offers to screens (see useApp in ../store).


import { createContext } from "react";
import type { Contact, Decision, Draft, ListFilter, Message, Task, Thread, View } from "../types";
import { type OutboxUpload } from "../outbox-files";
import { type TaskForm } from "../tasks";
import { ComposeDraft, ComposeDraftRequest, ComposeStatus, NewEmail } from "./compose";
import { Action, State } from "./reducer";

export type DraftPhase = "thinking" | "streaming";

export interface Ctx extends Omit<State, "byThread"> {
  dispatch: (action: Action) => void;
  contactById: (id: string) => Contact | undefined;
  threadById: (id: string) => Thread | undefined;
  /** Every loaded message, for search. */
  messages: Message[];
  /** Loaded messages and queued replies by conversation, oldest first. A list only changes when its conversation does. */
  messagesByThread: Map<string, Message[]>;
  messagesFor: (threadId: string) => Message[];
  messagesLoaded: (threadId: string) => boolean;
  /** Loads a conversation's newest messages, or with aroundMessageId every message from that one on. */
  loadMessages: (threadId: string, aroundMessageId?: string) => Promise<void>;
  /** Loads the page before the oldest loaded message. Resolves true when it added any. */
  loadOlderMessages: (threadId: string) => Promise<boolean>;
  /** Whether a conversation has earlier messages left to load. */
  hasOlder: (threadId: string) => boolean;
  /** Removes a queued or failed reply placeholder by its outbox id (a failed send you deleted or retried). */
  removePending: (outboxId: string) => void;
  /** Starts loading a conversation about to be opened. Does nothing once it is loaded or loading. */
  prefetchMessages: (threadId: string) => void;
  listThreads: (view: View, filter: ListFilter) => Thread[];
  notify: (text: string, undo?: () => void) => void;
  markRead: (id: string, read: boolean, opened?: boolean) => void;
  /** Archives one conversation or several, with one Undo toast. */
  archive: (ids: string | string[]) => void;
  /** Moves conversations to the mail provider's Bin (never deletes for good), with an Undo toast. */
  trash: (ids: string | string[]) => void;
  pin: (id: string, pinned: boolean) => void;
  /** Queues a reply. Resolves false when it could not be queued, so the composer keeps the text. */
  /** standalone leaves out the conversation's AI draft and Reply-to, for a message started elsewhere. */
  /** copies is Reply All (or an edited To and Cc): the reply goes to exactly those. Left out, the worker picks. */
  send: (threadId: string, body: string, fromAddress?: string, files?: OutboxUpload[], standalone?: boolean, copies?: { to: string[]; cc: string[] }) => Promise<boolean>;
  /** The message the next reply in each conversation answers, chosen with Reply on a message. */
  replyTo: Record<string, Message | undefined>;
  setReplyTo: (threadId: string, message: Message | null) => void;
  /** Reacts to a WhatsApp message, or removes your reaction with an empty emoji. Sent by the worker. */
  react: (message: Message, emoji: string) => void;
  /** Queues a new email. Resolves to the outbox row id, or null when it could not be queued. */
  composeEmail: (email: NewEmail) => Promise<string | null>;
  /** Queues a first WhatsApp message to one E.164 number. Resolves to the outbox row id, or null. */
  composeWhatsApp: (accountId: string, to: string, body: string, draftId?: string) => Promise<string | null>;
  /** Asks the AI to write (or with tone "edit", correct) a new message. Resolves to the draft's id; it arrives in composeDrafts. */
  generateComposeDraft: (request: ComposeDraftRequest) => Promise<string | null>;
  composeDrafts: Record<string, ComposeDraft | undefined>;
  /** Throws a new message's draft away (the dialog closed, or Undo), or with "revised", sets it aside for an edit of it. */
  discardComposeDraft: (id: string, status?: "discarded" | "revised") => void;
  /** New emails and WhatsApp chats queued this session, by outbox id. threadId arrives once it is stored. */
  composed: Record<string, ComposeStatus | undefined>;
  /** Re-reads a queued new email, for when a Realtime update is missed. */
  refreshCompose: (outboxId: string) => Promise<void>;
  /** Makes sure a conversation is in the list, loading it if it has only just been created. */
  ensureThread: (threadId: string) => Promise<boolean>;
  /** Saves the addresses an iCloud account sends from. Resolves false when it could not be saved. */
  saveSendAddresses: (accountId: string, addresses: string[]) => Promise<boolean>;
  /** Asks for a draft. decision is a guided drafting choice the draft must say. source is the text in the
   *  reply box: with tone "edit" it comes back lightly corrected, and with Shorter, More Formal or More
   *  Casual it is adjusted, instead of a new draft being written. audio is a recording of what the reply
   *  should say, in place of a typed instruction. */
  generateDraft: (threadId: string, tone?: Draft["tone"], instruction?: string, decision?: Decision, source?: string, audio?: Blob) => Promise<void>;
  discardDraft: (threadId: string) => void;
  /** Asks for a pre-draft when the conversation qualifies: on opening it, and while the app is open. */
  requestAutoDraft: (threadId: string) => Promise<void>;
  /** Moves conversations to or out of Junk, and email to or out of the provider's spam, with an Undo toast. */
  setJunk: (threadIds: string | string[], junk: boolean) => void;
  /** Queues unsubscribes for these senders. Resolves to how many were queued. */
  unsubscribe: (senders: { accountId: string; sender: string }[]) => Promise<number>;
  /** Records that the person unsubscribed on the sender's own page, for a request left at manual. */
  confirmUnsubscribe: (id: string) => void;
  drafting: Record<string, DraftPhase | undefined>;
  hydrated: boolean;
  giveFeedback: (id: string, value: "important" | "not_important") => void;
  /** Merges mergeId into keepId, with an Undo toast. Resolves to the merge id, or null when it failed. */
  mergeContacts: (keepId: string, mergeId: string, reason: "suggestion" | "manual", name?: string) => Promise<string | null>;
  /** Moves some of a contact's addresses and numbers to a new person. Resolves to their id, or null. */
  splitContact: (contactId: string, identityIds: string[], name: string) => Promise<string | null>;
  undoMerge: (mergeId: string) => Promise<boolean>;
  /** Reloads every contact after one is added or deleted, and the open conversations that involve these ids. */
  refreshContacts: (affected: string[]) => Promise<Contact[]>;
  /** Goes up after every merge, split or undo, so pages that load contacts themselves reload. */
  contactsVersion: number;
  /** Whether contacts holds every contact and is current, so a page can use it instead of reading them again. */
  contactsReady: boolean;
  /** Ticks a task off (done) or back on. Shown at once; the worker makes it at the provider, and a failure puts it back with a toast. */
  tickTask: (task: Task, done: boolean, via: "calendar" | "details" | "summary") => void;
  /** Makes a task at its provider. It shows at once; a failure takes it away again with a message. */
  createTask: (form: TaskForm) => void;
  /** Changes a task's title, notes, date or priority at its provider, shown at once and put back on failure. */
  editTask: (task: Task, form: TaskForm) => void;
  /** Deletes a task at its provider. It goes at once and comes back on failure. */
  deleteTask: (task: Task) => void;
}

export const AppContext = createContext<Ctx | null>(null);
