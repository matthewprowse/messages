"use client";

import { useCallback, useEffect, useState } from "react";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open } from "./vault";

// The owner's side of Teams, from the app's side (supabase/migrations/20261103100000_team_owner_features.sql): the work
// chats list and assigning, shared inboxes and who uses them, and response tracking. Everything here is a database
// function that checks who is asking; the lists carry labels sealed with the team's key, which are opened here.

const problem = (error: { message: string } | null) => error?.message || "Something went wrong. Try again.";

// ---------------------------------------------------------------------------
// Work chats
// ---------------------------------------------------------------------------

export type WorkFilter = "all" | "left" | "awaiting" | "unassigned";
export const WORK_FILTERS: { key: WorkFilter; label: string }[] = [
  { key: "all", label: "All Work Chats" },
  { key: "left", label: "Agent Has Left" },
  { key: "awaiting", label: "Awaiting Reply" },
  { key: "unassigned", label: "Not Assigned" },
];

export interface WorkChat {
  threadId: string;
  agentId: string;
  agentName: string;
  agentLeft: boolean;
  /** Who it is with, opened with the team's key. Empty until the worker has made it. */
  label: string;
  channel: string;
  /** account for a chat in a shared inbox, which has the inbox's name. */
  sharedBy: string;
  inboxName: string | null;
  lastMessageAt: string | null;
  awaiting: boolean;
  assigneeIds: string[];
}

export interface WorkCounts { all: number; left: number; awaiting: number; unassigned: number }
const NO_COUNTS: WorkCounts = { all: 0, left: 0, awaiting: 0, unassigned: 0 };

const WORK_PAGE = 100;

async function mapWork(rows: Awaited<ReturnType<typeof fetchWork>>["rows"]): Promise<WorkChat[]> {
  return Promise.all(rows.map(async (r): Promise<WorkChat> => ({
    threadId: r.thread_id,
    agentId: r.agent_id,
    agentName: r.agent_name ?? "Someone",
    agentLeft: r.agent_left,
    label: (await open(FIELD.name, r.share_label)) ?? "",
    channel: r.channel,
    sharedBy: r.shared_by,
    inboxName: r.inbox_name,
    lastMessageAt: r.last_message_at,
    awaiting: r.awaiting_reply,
    assigneeIds: r.assignee_ids ?? [],
  })));
}

async function fetchWork(filter: WorkFilter, offset: number, limit = WORK_PAGE) {
  const { data, error } = await supabase.rpc("work_chats", { p_filter: filter, p_limit: limit, p_offset: offset });
  return { rows: data ?? [], error };
}

/**
 * The workspace's work chats a page at a time for one filter, with how many each filter matches, and who has left with
 * chats still waiting on them. For an owner or admin, and for Compliance under strict sharing.
 */
export function useWorkChats(filter: WorkFilter) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [chats, setChats] = useState<WorkChat[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<WorkCounts>(NO_COUNTS);
  const [leftAgents, setLeftAgents] = useState<{ id: string; name: string; chats: number }[]>([]);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setFailed(false);
    const [page, count] = await Promise.all([fetchWork(filter, 0), supabase.rpc("work_chat_counts")]);
    if (page.error) return setFailed(true);
    const c = { ...NO_COUNTS, ...((count.data ?? {}) as Partial<WorkCounts>) };
    setCounts(c);
    setTotal(Number(page.rows[0]?.total_count ?? 0));
    setChats(await mapWork(page.rows));
    setMore(page.rows.length === WORK_PAGE);
    if (c.left > 0) {
      const left = await fetchWork("left", 0, 500);
      const byAgent = new Map<string, { id: string; name: string; chats: number }>();
      for (const r of left.rows) {
        const hit = byAgent.get(r.agent_id) ?? { id: r.agent_id, name: r.agent_name ?? "Someone", chats: 0 };
        hit.chats++;
        byAgent.set(r.agent_id, hit);
      }
      setLeftAgents([...byAgent.values()]);
    } else {
      setLeftAgents([]);
    }
  }, [userId, filter]);

  useEffect(() => { setChats(null); void load(); }, [load]);

  const loadMore = useCallback(async () => {
    const page = await fetchWork(filter, chats?.length ?? 0);
    if (page.error) return;
    const next = await mapWork(page.rows);
    setChats((c) => [...(c ?? []), ...next]);
    setMore(page.rows.length === WORK_PAGE);
  }, [filter, chats?.length]);

  return { chats, total, counts, leftAgents, failed, more, load, loadMore };
}

/** Assigns a work chat to a member, who then reads it. Returns a reason on failure, null when it worked. */
export async function assignThread(threadId: string, userId: string): Promise<string | null> {
  const { error } = await supabase.rpc("assign_thread", { p_thread: threadId, p_assignee: userId });
  return error ? problem(error) : null;
}

/** Takes a chat back from someone it is assigned to. Returns a reason on failure, null when it worked. */
export async function unassignThread(threadId: string, userId: string): Promise<string | null> {
  const { error } = await supabase.rpc("unassign_thread", { p_thread: threadId, p_assignee: userId });
  return error ? problem(error) : null;
}

/** Gives every work chat of someone who has left to one member. Returns how many were newly assigned, or a reason. */
export async function assignAgentChats(agentId: string, userId: string): Promise<{ assigned: number } | { problem: string }> {
  const { data, error } = await supabase.rpc("assign_agent_chats", { p_agent: agentId, p_assignee: userId });
  return error ? { problem: problem(error) } : { assigned: data ?? 0 };
}

// ---------------------------------------------------------------------------
// Shared inboxes
// ---------------------------------------------------------------------------

export interface SharedInbox {
  accountId: string;
  name: string;
  provider: string;
  status: string;
  connectedBy: string;
  connectedById: string;
  hasAccess: boolean;
  awaiting: number;
  /** Who is on the access list. Only an owner or admin is given it. */
  access: { userId: string; name: string }[];
}

/** The workspace's shared inboxes: those the person can use, and for an owner or admin all of them. */
export function useSharedInboxes() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [inboxes, setInboxes] = useState<SharedInbox[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.rpc("my_shared_inboxes");
    if (error) return setFailed(true);
    setFailed(false);
    setInboxes((data ?? []).map((r): SharedInbox => ({
      accountId: r.account_id,
      name: r.inbox_name,
      provider: r.provider,
      status: r.status,
      connectedBy: r.connected_by_name ?? "Someone",
      connectedById: r.connected_by,
      hasAccess: r.has_access,
      awaiting: r.awaiting,
      access: ((r.access ?? []) as { user_id: string; name: string }[]).map((a) => ({ userId: a.user_id, name: a.name })),
    })));
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  return { inboxes, failed, load };
}

/** An account of the person's own that could become a shared inbox. */
export interface ShareableAccount { id: string; label: string; provider: string }

/** The signed-in person's connected email and WhatsApp accounts that are not shared yet. */
export async function loadShareableAccounts(): Promise<ShareableAccount[]> {
  const { data } = await supabase.from("accounts").select("id, label, provider, status").is("workspace_id", null).in("provider", ["gmail", "outlook", "imap", "icloud", "whatsapp"]).neq("status", "disconnected");
  return (data ?? []).map((a) => ({ id: a.id, label: a.label, provider: a.provider }));
}

/** Makes one of your own accounts the team's shared inbox. Returns how many existing chats were shared, or a reason. */
export async function shareAccount(accountId: string, name: string): Promise<{ shared: number } | { problem: string }> {
  const { data, error } = await supabase.rpc("share_account", { p_account: accountId, p_name: name });
  return error ? { problem: problem(error) } : { shared: data ?? 0 };
}

/** Sets who can use a shared inbox. Returns a reason on failure, null when it worked. */
export async function setInboxAccess(accountId: string, userIds: string[]): Promise<string | null> {
  const { error } = await supabase.rpc("set_inbox_access", { p_account: accountId, p_users: userIds });
  return error ? problem(error) : null;
}

// ---------------------------------------------------------------------------
// Response tracking
// ---------------------------------------------------------------------------

export interface ResponseStat {
  /** Null for the shared inbox chats nobody is assigned. */
  userId: string | null;
  name: string;
  role: string | null;
  active: boolean;
  unanswered7: number;
  unanswered30: number;
  answered7: number;
  answered30: number;
  /** Median seconds from a client's message to the first answer, or null when none was answered. */
  median7: number | null;
  median30: number | null;
}

export interface WeekCount { week: string; userId: string; name: string; shared: number; movedBack: number }

/** Unanswered work chats and reply times per person, and the weekly counts of chats shared and moved back. Owner or admin. */
export function useResponseStats() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [stats, setStats] = useState<ResponseStat[] | null>(null);
  const [weeks, setWeeks] = useState<WeekCount[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setFailed(false);
    const [s, w] = await Promise.all([supabase.rpc("team_response_stats"), supabase.rpc("team_moved_back")]);
    if (s.error || w.error) return setFailed(true);
    setStats((s.data ?? []).map((r): ResponseStat => ({
      userId: r.user_id,
      name: r.name ?? "Not Assigned",
      role: r.role,
      active: r.active,
      unanswered7: r.unanswered_7d,
      unanswered30: r.unanswered_30d,
      answered7: r.answered_7d,
      answered30: r.answered_30d,
      median7: r.median_reply_7d,
      median30: r.median_reply_30d,
    })));
    setWeeks((w.data ?? []).map((r): WeekCount => ({ week: r.week, userId: r.user_id, name: r.name ?? "Someone", shared: r.chats_shared, movedBack: r.chats_moved_back })));
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  return { stats, weeks, failed, load };
}

/** A reply time in the units a team talks in: "12 min", "3 h 20 min", "2 days". */
export function replyTime(seconds: number | null): string {
  if (seconds === null) return "None Yet";
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "Under a Minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}
