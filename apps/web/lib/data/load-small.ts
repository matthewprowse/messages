// Loads the small tables behind the list screens (accounts, profile, rules, examples, drafts, unsubscribes, follow-ups,
// tasks), and the signed-in user's id. Shared by loadEverything and loadChanges.

import { openAddresses, openDrafts, openExamples, openTasks } from "../open-rows";
import { supabase } from "../supabase";
import type { Rule, Task } from "../types";
import { allRows } from "../contacts";
import { mapTask, TASK_COLUMNS } from "../tasks";
import { ACCOUNT_COLUMNS, DRAFT_COLUMNS, PROFILE_COLUMNS, UNSUBSCRIBE_COLUMNS } from "./columns";
import { mapAccount, mapDraft, mapProfile, mapUnsubscribe } from "./map-small";

/** How far back completed tasks are shown in Calendar. Open ones are loaded however old, as they are overdue. */
const TASK_DAYS = 60;

/** The signed-in user's ID, from the session held in the browser. */
export async function myId(): Promise<string> {
  return (await supabase.auth.getSession()).data.session?.user.id ?? "";
}

/** Tasks with a due date: every open one however old, and completed ones from the last TASK_DAYS days. Paged, so none is cut at 1000. */
export async function loadTasks(): Promise<Task[]> {
  const taskSince = new Date(Date.now() - TASK_DAYS * 86_400_000).toISOString();
  // id breaks ties between tasks due at the same moment, so paging neither repeats nor skips one.
  const rows = await allRows("Load tasks", (from, to) =>
    supabase.from("tasks").select(TASK_COLUMNS).not("due_at", "is", null).or(`status.eq.open,due_at.gte.${taskSince}`).order("due_at").order("id").range(from, to));
  await openTasks(rows);
  return rows.map(mapTask);
}

/** The small tables behind the list screens: everything except the conversations and contacts. */
export async function loadSmall() {
  const [accounts, profile, rules, examples, drafts, unsubscribes, followUps, tasks] = await Promise.all([
    supabase.from("accounts").select(ACCOUNT_COLUMNS),
    supabase.from("profiles").select(PROFILE_COLUMNS).maybeSingle(),
    allRows("Load rules", (from, to) => supabase.from("priority_rules").select("id, kind, target").order("created_at", { ascending: false }).order("id").range(from, to)),
    allRows("Load examples", (from, to) => supabase.from("writing_examples").select("id, situation, body").order("created_at", { ascending: false }).order("id").range(from, to)),
    // A new message's draft (no conversation) lives in its dialog only.
    allRows("Load drafts", (from, to) => supabase.from("drafts").select(DRAFT_COLUMNS).eq("status", "active").not("thread_id", "is", null).order("id").range(from, to)),
    allRows("Load unsubscribes", (from, to) => supabase.from("unsubscribes").select(UNSUBSCRIBE_COLUMNS).order("id").range(from, to)),
    // Not required: without it (the table not there yet) the Waiting filter is just empty.
    allRows("Load follow-ups", (from, to) => supabase.from("follow_ups").select("thread_id").eq("expects_reply", true).order("id").range(from, to)).catch(() => []),
    // Not required either: without it (no task account, or the table not there yet) Calendar shows events only.
    loadTasks().catch(() => []),
  ]);
  if (accounts.error) throw accounts.error;
  if (profile.error) throw profile.error;
  await Promise.all([
    openDrafts(drafts),
    openAddresses([accounts.data ?? [], rules, unsubscribes]),
    openExamples(examples),
  ]);
  const draftOf = new Map(drafts.map((d) => [d.thread_id, mapDraft(d)]));
  const waiting = new Set(followUps.map((f) => f.thread_id));
  return {
    draftOf,
    waiting,
    accounts: (accounts.data ?? []).map(mapAccount),
    rules: rules.map((r) => ({ id: r.id, kind: r.kind as Rule["kind"], target: r.target })),
    writingExamples: examples.map((w) => ({ id: w.id, context: w.situation, text: w.body })),
    profile: mapProfile(profile.data),
    unsubscribes: unsubscribes.map(mapUnsubscribe),
    tasks,
  };
}
