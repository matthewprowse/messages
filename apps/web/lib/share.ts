"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open } from "./vault";
import type { TeamRole } from "./team";

// Sharing a chat, from the app's side: whether the signed-in person is in a team, marking a chat as work or moving it
// back (database functions that check who is asking, in supabase/migrations/20261101120000_shared_chats.sql), and what
// they share. The chat's rows are re-encrypted by the sync worker afterwards, so a chat is Sharing for a few seconds.

/** What the person's team means for sharing: which workspace, whether strict sharing is on, and their role. */
export interface MyTeam {
  workspaceId: string;
  strict: boolean;
  role: TeamRole;
}

// One read for the whole app, so a list of a thousand chats asks once. null is no team, undefined is not read yet.
let current: { userId: string | null; team: MyTeam | null | undefined } = { userId: null, team: undefined };
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

async function readTeam(userId: string) {
  const [ws, role] = await Promise.all([supabase.from("workspaces").select("id, strict_sharing").maybeSingle(), supabase.rpc("my_workspace_role")]);
  if (ws.error || role.error) return; // keeps what it had: not knowing is not the same as having no team
  const team = ws.data && role.data ? { workspaceId: ws.data.id, strict: ws.data.strict_sharing, role: role.data as TeamRole } : null;
  if (current.userId !== userId) return;
  current = { userId, team };
  listeners.forEach((fn) => fn());
}

/** Reads the person's team again, for after strict sharing changes or they join or leave. */
export function refreshMyTeam() {
  if (current.userId) void readTeam(current.userId);
}

/** The signed-in person's team for sharing: undefined while it loads, null without a team. */
export function useMyTeam(): MyTeam | null | undefined {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId || current.userId === userId) return;
    current = { userId, team: undefined };
    void readTeam(userId);
  }, [userId]);
  const team = useSyncExternalStore(subscribe, () => current.team, () => undefined);
  return userId && current.userId === userId ? team : undefined;
}

/** How far back a chat can be shared from: now, a date, or the whole history (null). */
export type ShareFrom = Date | null;

const problem = (error: { message: string } | null) => error?.message || "Something went wrong. Try again.";

/**
 * Marks one of your chats as work. A chat Konva suggested goes through accept_share_suggestions, so it is recorded as
 * shared by a suggestion. Returns a reason on failure, null when it worked.
 */
export async function markWork(threadId: string, from: ShareFrom, suggested = false): Promise<string | null> {
  const p_share_from = from ? from.toISOString() : null;
  const { error } = suggested
    ? await supabase.rpc("accept_share_suggestions", { p_threads: [threadId], p_share_from })
    : await supabase.rpc("mark_thread_work", { p_thread: threadId, p_share_from });
  return error ? problem(error) : null;
}

/** Marks several suggested chats as work at once (the review after joining a team). Returns how many were shared, or a reason. */
export async function acceptSuggestions(threadIds: string[], from: ShareFrom): Promise<{ shared: number } | { problem: string }> {
  const { data, error } = await supabase.rpc("accept_share_suggestions", { p_threads: threadIds, p_share_from: from ? from.toISOString() : null });
  return error ? { problem: problem(error) } : { shared: data ?? 0 };
}

/** Not Work: turns down Konva's suggestion for one chat, which is not suggested again. Returns a reason on failure, null when it worked. */
export async function dismissSuggestion(threadId: string): Promise<string | null> {
  const { error } = await supabase.rpc("dismiss_share_suggestion", { p_thread: threadId });
  return error ? problem(error) : null;
}

/** Moves a work chat back to personal. Returns a reason on failure, null when it worked. */
export async function markPersonal(threadId: string): Promise<string | null> {
  const { error } = await supabase.rpc("mark_thread_personal", { p_thread: threadId });
  return error ? problem(error) : null;
}

/** When the first message of a chat was sent, or null when it has none stored. */
export async function firstMessageAt(threadId: string): Promise<string | null> {
  const { data } = await supabase.from("messages").select("sent_at").eq("thread_id", threadId).order("sent_at").limit(1).maybeSingle();
  return data?.sent_at ?? null;
}

const POLL_MS = 4000;

/** Whether the worker is still sealing this chat after it was marked as work. Polls while it is. */
export function useSharing(threadId: string, shared: boolean) {
  const [sharing, setSharing] = useState(false);
  const check = useCallback(async () => {
    const { data } = await supabase.from("share_jobs").select("direction, status, attempts").eq("thread_id", threadId).eq("follow_up", false)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    // A failed job is tried again until it has had five attempts.
    setSharing(!!data && data.direction === "to_work" && (data.status === "queued" || data.status === "working" || (data.status === "failed" && data.attempts < 5)));
  }, [threadId]);
  useEffect(() => {
    if (!shared) { setSharing(false); return; }
    void check();
  }, [shared, threadId, check]);
  useEffect(() => {
    if (!sharing) return;
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [sharing, check]);
  return { sharing, check };
}

export interface SharedChat {
  threadId: string;
  /** Who the chat is with, opened with the team's key. Empty until the worker has made it. */
  label: string;
  channel: string;
  sharedAt: string;
  sharedBy: string;
  shareFrom: string | null;
  lastMessageAt: string | null;
  state: "sharing" | "failed" | "shared";
  assignees: { userId: string; name: string }[];
  /** The days Compliance opened this chat, newest first (the last five). */
  complianceOpens: string[];
}

/** The chats the signed-in person shares, with who each is assigned to. Reloads while any is still being sealed. */
export function useSharedChats() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [chats, setChats] = useState<SharedChat[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.rpc("my_shared_chats");
    if (error) return setFailed(true);
    setFailed(false);
    const rows = await Promise.all((data ?? []).map(async (r): Promise<SharedChat> => ({
      threadId: r.thread_id,
      label: (await open(FIELD.name, r.share_label)) ?? "",
      channel: r.channel,
      sharedAt: r.shared_at,
      sharedBy: r.shared_by,
      shareFrom: r.share_from,
      lastMessageAt: r.last_message_at,
      state: r.state as SharedChat["state"],
      assignees: ((r.assignees ?? []) as { user_id: string; name: string }[]).map((a) => ({ userId: a.user_id, name: a.name })),
      complianceOpens: (r.compliance_opens ?? []) as string[],
    })));
    setChats(rows);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  const sealing = !!chats?.some((c) => c.state === "sharing");
  useEffect(() => {
    if (!sealing) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [sealing, load]);
  return { chats, failed, load };
}
