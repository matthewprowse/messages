"use client";

// A shared chat from the side of someone who is not its agent (supabase/migrations/20261103100000_team_owner_features.sql):
// the chats assigned to you, the chats of a shared inbox you use, and one chat open for reading, with the team's notes,
// who is replying, and the two ways to answer. An assignee has no write access to the agent's rows: they answer from their
// OWN account, a new conversation linked to the chat (outbox.for_thread_id). A member of a shared inbox answers in the chat,
// from the shared account. Compliance reads and never answers.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encryptTeamField } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open, seal, teamKeys } from "./vault";
import { sealAddress } from "./address-refs";
import { loadThreadMessages } from "./data";
import { useMyTeam } from "./share";
import { isE164 } from "./new-items";
import type { Message } from "./types";

const problem = (error: { message: string } | null) => error?.message || "Something went wrong. Try again.";
const POLL_MS = 10_000;

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export interface TeamChatRow {
  threadId: string;
  /** Who it is with, opened with the team's key. Empty until the worker has made it. */
  label: string;
  preview: string;
  channel: string;
  lastMessageAt: string | null;
  awaiting: boolean;
  assignees: { userId: string; name: string }[];
}

export interface AssignedChat extends TeamChatRow {
  agentName: string;
  agentLeft: boolean;
  /** The shared inbox's name when the chat is in one, else null. */
  inboxName: string | null;
  assignedAt: string;
  /** When the cover that gives the person this chat ends. null for a chat assigned to them. */
  coverUntil: string | null;
}

const people = (raw: unknown) => ((raw ?? []) as { user_id: string; name: string }[]).map((a) => ({ userId: a.user_id, name: a.name }));

/** The chats assigned to the signed-in person, newest first. Labels and previews are opened with the team's key. */
export function useAssignedChats() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [chats, setChats] = useState<AssignedChat[] | null>(null);
  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.rpc("my_assigned_chats");
    if (error) return;
    setChats(await Promise.all((data ?? []).map(async (r): Promise<AssignedChat> => ({
      threadId: r.thread_id,
      label: (await open(FIELD.name, r.share_label)) ?? "",
      preview: (await open(FIELD.preview, r.preview)) ?? "",
      channel: r.channel,
      lastMessageAt: r.last_message_at,
      awaiting: r.awaiting_reply,
      assignees: people(r.assignees),
      agentName: r.agent_name ?? "Someone",
      agentLeft: r.agent_left,
      inboxName: r.shared_by === "account" ? r.inbox_name : null,
      assignedAt: r.assigned_at,
      coverUntil: r.cover_until,
    }))));
  }, [userId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);
  return { chats, load };
}

const INBOX_PAGE = 20;

/** One shared inbox's chats, newest first, a page at a time. */
export function useInboxChats(accountId: string | null) {
  const [chats, setChats] = useState<TeamChatRow[] | null>(null);
  const [more, setMore] = useState(false);
  const map = (rows: NonNullable<Awaited<ReturnType<typeof fetchInbox>>["data"]>) => Promise.all(rows.map(async (r): Promise<TeamChatRow> => ({
    threadId: r.thread_id,
    label: (await open(FIELD.name, r.share_label)) ?? "",
    preview: (await open(FIELD.preview, r.preview)) ?? "",
    channel: r.channel,
    lastMessageAt: r.last_message_at,
    awaiting: r.awaiting_reply,
    assignees: people(r.assignees),
  })));
  const first = useCallback(async () => {
    if (!accountId) return setChats(null);
    const { data, error } = await fetchInbox(accountId, null);
    if (error) return;
    setChats(await map(data ?? []));
    setMore((data ?? []).length === INBOX_PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);
  useEffect(() => {
    setChats(null);
    void first();
    const timer = setInterval(() => void first(), 30_000);
    return () => clearInterval(timer);
  }, [first]);
  const loadMore = useCallback(async () => {
    const last = chats?.[chats.length - 1]?.lastMessageAt;
    if (!accountId || !last) return;
    const { data, error } = await fetchInbox(accountId, last);
    if (error) return;
    const next = await map(data ?? []);
    setChats((c) => [...(c ?? []), ...next.filter((n) => !c?.some((x) => x.threadId === n.threadId))]);
    setMore((data ?? []).length === INBOX_PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, chats]);
  return { chats, more, loadMore, reload: first };
}

const fetchInbox = (accountId: string, before: string | null) => supabase.rpc("shared_inbox_chats", { p_account: accountId, p_limit: INBOX_PAGE, p_before: before });

// ---------------------------------------------------------------------------
// One chat
// ---------------------------------------------------------------------------

export interface SharedChatInfo {
  threadId: string;
  label: string;
  subject: string;
  channel: string;
  isGroup: boolean;
  sharedBy: string;
  agentId: string;
  agentName: string;
  agentLeft: boolean;
  accountId: string;
  inboxName: string | null;
  /** The workspace the chat is shared in. */
  workspaceId: string;
  /** When the cover that lets the person in ends, for a covered chat. */
  coverEnds: string | null;
  /** How the person is let in: as the agent, an assignee, covering the agent, a member of the inbox, or Compliance (which has opened it). */
  access: "agent" | "assignee" | "cover" | "inbox" | "compliance";
  /** How they may answer: from the shared account, from their own account, or not at all. */
  reply: "inbox" | "own" | null;
  assignees: { userId: string; name: string }[];
}

/** A message in the timeline: the shared chat's own, or one from the person's own conversation with the same client. */
export interface TimelineMessage extends Message {
  own?: boolean;
}

/** Their own conversations started from this chat, newest first. */
async function ownConversations(threadId: string): Promise<{ threadId: string; at: string | null }[]> {
  const { data } = await supabase.from("outbox").select("thread_id, sent_at").eq("for_thread_id", threadId).not("thread_id", "is", null).order("created_at", { ascending: false });
  const seen = new Set<string>();
  return (data ?? []).filter((r) => r.thread_id && !seen.has(r.thread_id) && seen.add(r.thread_id)).map((r) => ({ threadId: r.thread_id!, at: r.sent_at }));
}

/**
 * One shared chat open for reading. Compliance's open is logged first, which is what lets the database show them the
 * messages at all. Returns null info when the person may not open it (an owner or admin has to assign it to themselves
 * first). Messages are the shared chat's, and for an assignee, those of the conversations they started from their own account
 * with the same client, so the timeline reads as one.
 */
export function useSharedChat(threadId: string) {
  const team = useMyTeam();
  const [info, setInfo] = useState<SharedChatInfo | null | undefined>(undefined);
  const [messages, setMessages] = useState<TimelineMessage[] | null>(null);
  const [older, setOlder] = useState(false);
  const [failed, setFailed] = useState(false);
  const logged = useRef<string | null>(null);
  const relogged = useRef(false);

  const load = useCallback(async () => {
    if (team === undefined) return;
    // Compliance is let in by the log: no row, no messages.
    if (team?.role === "compliance" && logged.current !== threadId) {
      const { error } = await supabase.rpc("log_compliance_open", { p_thread: threadId });
      if (error) { setInfo(null); return; }
      logged.current = threadId;
    }
    const { data, error } = await supabase.rpc("shared_chat_info", { p_thread: threadId });
    if (error) return setFailed(true);
    setFailed(false);
    const raw = data as Record<string, unknown> | null;
    if (!raw) {
      // Compliance's window closes after a few hours: open it again once, then give up.
      if (team?.role === "compliance" && logged.current === threadId && !relogged.current) { relogged.current = true; logged.current = null; return void load(); }
      setInfo(null);
      setMessages([]);
      return;
    }
    relogged.current = false;
    const next: SharedChatInfo = {
      threadId,
      label: (await open(FIELD.name, raw.label as string | null)) ?? "",
      subject: (await open(FIELD.subject, raw.subject as string | null)) ?? "",
      channel: raw.channel as string,
      isGroup: raw.is_group === true,
      sharedBy: raw.shared_by as string,
      agentId: raw.agent_id as string,
      agentName: (raw.agent_name as string | null) ?? "Someone",
      agentLeft: raw.agent_left === true,
      accountId: raw.account_id as string,
      inboxName: (raw.inbox_name as string | null) ?? null,
      workspaceId: raw.workspace_id as string,
      coverEnds: (raw.cover_ends as string | null) ?? null,
      access: raw.access as SharedChatInfo["access"],
      reply: (raw.reply as SharedChatInfo["reply"]) ?? null,
      assignees: people(raw.assignees),
    };
    setInfo(next);
    try {
      const page = await loadThreadMessages(threadId);
      const own = next.reply === "own" ? await ownConversations(threadId) : [];
      const mine = (await Promise.all(own.map((c) => loadThreadMessages(c.threadId).then((p) => p.messages).catch(() => [] as Message[])))).flat().map((m): TimelineMessage => ({ ...m, own: true }));
      const all = [...page.messages, ...mine].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));
      setMessages(all);
      setOlder(page.more);
    } catch {
      setFailed(true);
    }
  }, [threadId, team]);

  useEffect(() => { setInfo(undefined); setMessages(null); logged.current = null; relogged.current = false; }, [threadId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // New messages arrive, and the worker seals them a moment later: either way, read again.
  useEffect(() => {
    let wait: ReturnType<typeof setTimeout> | undefined;
    const again = () => { clearTimeout(wait); wait = setTimeout(() => void load(), 600); };
    const channel = supabase.channel(`shared-messages-${threadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` }, again)
      .subscribe();
    return () => { clearTimeout(wait); void supabase.removeChannel(channel); };
  }, [threadId, load]);

  const loadOlder = useCallback(async () => {
    const first = messages?.find((m) => !m.own);
    if (!first) return;
    const page = await loadThreadMessages(threadId, { before: first });
    setMessages((m) => [...page.messages, ...(m ?? [])]);
    setOlder(page.more);
  }, [threadId, messages]);

  return { info, messages, older, failed, load, loadOlder };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export interface ThreadNote { id: string; userId: string; text: string; createdAt: string }

/** A note, sealed with the team's key. It reads as a note, not as a message or a draft, and is never sent anywhere. */
async function sealNote(text: string): Promise<string> {
  const team = await teamKeys();
  if (!team) throw new Error("no team key");
  return encryptTeamField(team, FIELD.note, text);
}

/** The team's notes on a chat, live. Readable by whoever can open the chat. */
export function useNotes(threadId: string, enabled: boolean) {
  const [notes, setNotes] = useState<ThreadNote[]>([]);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("thread_notes").select("id, user_id, body, created_at").eq("thread_id", threadId).order("created_at");
    if (error) return;
    setNotes(await Promise.all((data ?? []).map(async (n): Promise<ThreadNote> => ({ id: n.id, userId: n.user_id, text: (await open(FIELD.note, n.body)) ?? "", createdAt: n.created_at }))));
  }, [threadId]);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const channel = supabase.channel(`notes-${threadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_notes", filter: `thread_id=eq.${threadId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [threadId, enabled, load]);

  const add = useCallback(async (text: string): Promise<string | null> => {
    try {
      const body = await sealNote(text.trim());
      const { error } = await supabase.rpc("add_thread_note", { p_thread: threadId, p_body: body });
      if (error) return problem(error);
      void load();
      return null;
    } catch {
      return "Your team's key is not available. Reload the page and try again.";
    }
  }, [threadId, load]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    const { error } = await supabase.rpc("delete_thread_note", { p_note: id });
    if (error) return problem(error);
    setNotes((n) => n.filter((x) => x.id !== id));
    return null;
  }, []);

  return { notes, add, remove };
}

// ---------------------------------------------------------------------------
// Someone is replying
// ---------------------------------------------------------------------------

const TYPING_MS = 5000;

/**
 * Who else is typing a reply in this chat, through Realtime presence on a private channel (chat:<id>, which the database
 * lets only people who can open the chat join). The payload is a name and a flag, never text. setTyping(true) keeps
 * "typing" on for a few seconds and renews itself on each keystroke.
 */
export function useReplyingPresence(threadId: string, enabled: boolean, myName: string) {
  const { session } = useAuth();
  const me = session?.user.id;
  const [others, setOthers] = useState<string[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribed = useRef(false);
  const stop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nameRef = useRef(myName);
  nameRef.current = myName;

  useEffect(() => {
    if (!enabled || !me) return;
    const channel = supabase.channel(`chat:${threadId}`, { config: { private: true, presence: { key: me } } });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string; typing: boolean }>();
        const names = Object.entries(state).filter(([key]) => key !== me).flatMap(([, metas]) => metas).filter((m) => m.typing).map((m) => m.name || "Someone");
        setOthers([...new Set(names)]);
      })
      .subscribe((status) => {
        subscribed.current = status === "SUBSCRIBED";
        if (subscribed.current) void channel.track({ name: nameRef.current, typing: false });
      });
    return () => {
      clearTimeout(stop.current);
      subscribed.current = false;
      channelRef.current = null;
      setOthers([]);
      void supabase.removeChannel(channel);
    };
  }, [threadId, enabled, me]);

  const setTyping = useCallback((typing: boolean) => {
    clearTimeout(stop.current);
    const channel = channelRef.current;
    if (channel && subscribed.current) void channel.track({ name: nameRef.current, typing });
    if (typing) stop.current = setTimeout(() => setTyping(false), TYPING_MS);
  }, []);

  return { others, setTyping };
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/** Queues a reply in a shared inbox's chat. The worker sends it from the shared account. Resolves to the outbox row, or a reason. */
export async function sendInboxReply(threadId: string, body: string): Promise<{ id: string } | { problem: string }> {
  const { data, error } = await supabase.from("outbox").insert({ thread_id: threadId, body: await seal(FIELD.body, body) }).select("id").single();
  return error || !data ? { problem: problem(error) } : { id: data.id };
}

/** Queues a new conversation from the person's own account, to the same client, linked to the shared chat it answers. */
export async function sendOwnReply(input: { threadId: string; accountId: string; channel: "email" | "whatsapp"; to: string; subject: string; body: string }): Promise<{ id: string } | { problem: string }> {
  const row = {
    account_id: input.accountId,
    to_addresses: [await sealAddress(input.to)],
    body: await seal(FIELD.body, input.body),
    for_thread_id: input.threadId,
    ...(input.channel === "email" ? { subject: await seal(FIELD.subject, input.subject || null) } : {}),
  };
  const { data, error } = await supabase.from("outbox").insert(row).select("id").single();
  return error || !data ? { problem: problem(error) } : { id: data.id };
}

/** Where a queued reply has got to. */
export async function outboxState(id: string): Promise<{ status: string; error: string | null }> {
  const { data } = await supabase.from("outbox").select("status, error").eq("id", id).maybeSingle();
  return { status: data?.status ?? "queued", error: data?.error ?? null };
}

/**
 * The client in a chat, for answering from your own account: the latest message from them and the address or number it
 * came from. For email the address, for WhatsApp a phone number (a privacy ID cannot be written to). null when there is none.
 */
export function clientAddress(messages: Message[], channel: string): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.from === "me" || m.sendState || !m.address) continue;
    const address = m.address.trim();
    if (channel === "email" && /^[^\s@]+@[^\s@]+$/.test(address)) return address.toLowerCase();
    if (channel === "whatsapp" && isE164(address)) return address;
  }
  return null;
}

/** Replies already sent from the person's own account for this chat, newest first. */
export function useMyReplies(threadId: string, enabled: boolean) {
  const [replies, setReplies] = useState<{ id: string; status: string; sentAt: string | null; threadId: string | null }[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from("outbox").select("id, status, sent_at, thread_id").eq("for_thread_id", threadId).order("created_at", { ascending: false });
    setReplies((data ?? []).map((r) => ({ id: r.id, status: r.status, sentAt: r.sent_at, threadId: r.thread_id })));
  }, [threadId]);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  return useMemo(() => ({ replies, reload: load }), [replies, load]);
}
