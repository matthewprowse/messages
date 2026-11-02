// Reading and writing automations, asking for a 30 day preview, loading the run history and undoing a run. The setup and what a run
// read are sealed with the user's key (automation, automation_run) and opened here; row level security scopes every query to the
// user. Only the AI worker makes runs and answers previews. Undo is done here, with the user's own rights, from the ids a run recorded.

import { FIELD } from "@messages/crypto/fields";
import { deleteContact } from "../contacts";
import { supabase } from "../supabase";
import { open, seal } from "../vault";
import { readPreview, type PreviewResult } from "./preview";
import { parseSpec, specText, type AutomationSpec } from "./spec";
import { deletable, readEffects, undoneText, type Activity, type Effects } from "./undo";

export interface Automation {
  id: string;
  templateKey: string | null;
  enabled: boolean;
  enabledAt: string | null;
  spec: AutomationSpec;
}

export type RunStatus = "running" | "done" | "skipped" | "failed" | "undone";

export interface Run {
  id: string;
  automationId: string;
  messageId: string;
  threadId: string | null;
  status: RunStatus;
  readBy: "parser" | "gemini" | null;
  fields: Record<string, string> | null;
  contactId: string | null;
  effects: Effects;
  error: string | null;
  createdAt: string;
}

const RUN_LIMIT = 100;
const PREVIEW_WAIT_MS = 90_000;
const PREVIEW_POLL_MS = 1500;

/** Every automation of the user, setup opened. One whose setup cannot be read is left out. */
export async function loadAutomations(): Promise<Automation[]> {
  const { data, error } = await supabase.from("automations").select("id, template_key, enabled, enabled_at, spec").order("created_at");
  if (error) throw new Error(`Load automations failed (${error.code})`);
  const out: Automation[] = [];
  for (const r of data) {
    const spec = parseSpec(await open(FIELD.automation, r.spec));
    if (spec) out.push({ id: r.id, templateKey: r.template_key, enabled: r.enabled, enabledAt: r.enabled_at, spec });
  }
  return out;
}

/** Makes or changes an automation. Resolves to an error sentence, or null. enabled is set only when given. */
export async function saveAutomation(input: { id?: string; templateKey: string | null; spec: AutomationSpec; enabled?: boolean }): Promise<string | null> {
  const sealed = await seal(FIELD.automation, specText(input.spec)).catch(() => null);
  if (!sealed) return "Could not save. Check your connection and try again.";
  const now = new Date().toISOString();
  const turnedOn = input.enabled === undefined ? {} : { enabled: input.enabled, ...(input.enabled ? { enabled_at: now } : {}) };
  const { error } = input.id
    ? await supabase.from("automations").update({ spec: sealed, updated_at: now, ...turnedOn }).eq("id", input.id)
    : await supabase.from("automations").insert({ template_key: input.templateKey as "property24" | "private_property" | null, spec: sealed, ...turnedOn });
  return error ? "Could not save. Check your connection and try again." : null;
}

/** Turns an automation on or off. Turning it on restarts its clock: only mail that arrives after this is run. */
export async function setEnabled(id: string, enabled: boolean): Promise<string | null> {
  const { error } = await supabase.from("automations").update({ enabled, ...(enabled ? { enabled_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }).eq("id", id);
  return error ? "Could not change it. Check your connection and try again." : null;
}

/** Deletes an automation and, with it, its run history. What the runs made (contacts, tasks, drafts) stays. */
export async function removeAutomation(id: string): Promise<string | null> {
  const { error } = await supabase.from("automations").delete().eq("id", id);
  return error ? "Could not delete it. Check your connection and try again." : null;
}

/** Asks the AI worker for the 30 day preview of a setup. Resolves to the request's id, or null. */
export async function requestPreview(spec: AutomationSpec, templateKey: string | null): Promise<string | null> {
  const sealed = await seal(FIELD.automation, specText(spec)).catch(() => null);
  if (!sealed) return null;
  const { data, error } = await supabase.from("automation_previews").insert({ template_key: templateKey as "property24" | "private_property" | null, spec: sealed }).select("id").single();
  return error || !data ? null : data.id;
}

/** Waits for the worker's answer. Resolves to the result, or an error sentence when it failed, took too long or was cancelled. */
export async function waitForPreview(id: string, signal: AbortSignal): Promise<{ result: PreviewResult } | { error: string }> {
  const started = Date.now();
  while (!signal.aborted && Date.now() - started < PREVIEW_WAIT_MS) {
    const { data, error } = await supabase.from("automation_previews").select("status, result").eq("id", id).maybeSingle();
    if (!error && data?.status === "failed") return { error: "The preview could not be made. Try again." };
    if (!error && data?.status === "done") {
      const result = readPreview(await open(FIELD.automationRun, data.result));
      return result ? { result } : { error: "The preview could not be read. Try again." };
    }
    await new Promise((r) => setTimeout(r, PREVIEW_POLL_MS));
  }
  return { error: signal.aborted ? "" : "The preview is taking too long. Check that the AI worker is running, then try again." };
}

/** Removes a preview request once it has been read. Best effort. */
export async function dropPreview(id: string): Promise<void> {
  await supabase.from("automation_previews").delete().eq("id", id);
}

/** The newest runs, with what they read opened. */
export async function loadRuns(): Promise<Run[]> {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("id, automation_id, message_id, thread_id, status, read_by, fields, contact_id, effects, error, created_at")
    .order("created_at", { ascending: false })
    .limit(RUN_LIMIT);
  if (error) throw new Error(`Load automation runs failed (${error.code})`);
  const out: Run[] = [];
  for (const r of data) {
    let fields: Record<string, string> | null = null;
    try {
      const parsed = JSON.parse((await open(FIELD.automationRun, r.fields)) ?? "");
      fields = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      fields = null;
    }
    out.push({
      id: r.id, automationId: r.automation_id, messageId: r.message_id, threadId: r.thread_id, status: r.status as RunStatus,
      readBy: r.read_by === "gemini" ? "gemini" : r.read_by === "parser" ? "parser" : null, fields, contactId: r.contact_id,
      effects: readEffects(r.effects), error: r.error, createdAt: r.created_at,
    });
  }
  return out;
}

async function count(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count: n, error } = await query;
  if (error) throw new Error("Undo check failed");
  return n ?? 0;
}

/** How much else is tied to the contact besides this run. Any failed read rejects, so Undo then keeps the contact. */
async function activityOf(run: Run, taskIds: string[]): Promise<Activity> {
  const contact = run.contactId!;
  const head = { count: "exact", head: true } as const;
  const [otherThreads, tasks, otherRuns, drafts, messages] = await Promise.all([
    count(supabase.from("thread_participants").select("thread_id", head).eq("contact_id", contact).neq("thread_id", run.threadId ?? "00000000-0000-0000-0000-000000000000")),
    supabase.from("tasks").select("id").eq("contact_id", contact),
    count(supabase.from("automation_runs").select("id", head).eq("contact_id", contact).neq("id", run.id).in("status", ["done", "running"])),
    supabase.from("drafts").select("id").eq("contact_id", contact),
    count(supabase.from("messages").select("id", head).eq("sender_contact_id", contact)),
  ]);
  if (tasks.error || drafts.error) throw new Error("Undo check failed");
  return {
    otherThreads, otherRuns, messages,
    otherTasks: tasks.data.filter((t) => !taskIds.includes(t.id)).length,
    otherDrafts: drafts.data.filter((d) => d.id !== run.effects.draft_id).length,
  };
}

/** Reverses a run: the draft and task it made, the urgent mark, and the contact (deleted when it made them and nothing else has
 *  happened to them, otherwise only its own marks come off). Resolves to the sentence to show, or throws with one. */
export async function undoRun(run: Run): Promise<string> {
  const fx = run.effects;
  const done = { contactDeleted: false, leadRemoved: false, taskRemoved: false, draftRemoved: false, urgentRestored: false };
  const fail = (what: string): never => { throw new Error(`${what} Nothing else was changed.`); };

  if (fx.draft_id) {
    const { data, error } = await supabase.from("drafts").delete().eq("id", fx.draft_id).in("status", ["pending", "active"]).select("id");
    if (error) fail("Could not remove the draft.");
    done.draftRemoved = (data?.length ?? 0) > 0;
  }

  // The task: found through the contact (the worker pairs the task it makes with the contact), created after the run began.
  let taskIds: string[] = [];
  if (run.contactId && fx.task_update_id) {
    const { data, error } = await supabase.from("tasks").select("id").eq("contact_id", run.contactId).gte("created_at", run.createdAt).order("created_at").limit(1);
    if (error) fail("Could not look for the task.");
    taskIds = (data ?? []).map((t) => t.id);
    if (taskIds.length) {
      const { error: queued } = await supabase.from("task_updates").insert({ action: "delete", task_id: taskIds[0] });
      if (queued) fail("Could not remove the task.");
      done.taskRemoved = true;
    } else {
      // Not made yet: take it back off the queue if it is still waiting.
      const { data: waiting } = await supabase.from("task_updates").delete().eq("id", fx.task_update_id).eq("status", "queued").select("id");
      done.taskRemoved = (waiting?.length ?? 0) > 0;
    }
  }

  if (fx.thread_before && run.threadId) {
    const before = fx.thread_before;
    const back = { ...(before.priority ? { priority: before.priority } : {}), junk: before.junk ?? false, needs_reply: before.needs_reply ?? false };
    const { data } = await supabase.from("threads").update(back).eq("id", run.threadId).eq("priority", "urgent").select("id");
    done.urgentRestored = (data?.length ?? 0) > 0;
    if (done.urgentRestored && run.messageId) await supabase.from("message_ai").update(back).eq("message_id", run.messageId);
  }

  if (run.contactId) {
    let remove = false;
    try {
      remove = deletable(fx, await activityOf(run, taskIds));
    } catch {
      remove = false; // cannot prove nothing else happened to them, so they stay
    }
    if (remove) {
      const problem = await deleteContact(run.contactId);
      if (problem) fail("Could not delete the contact.");
      done.contactDeleted = true;
    } else {
      if (fx.linked && run.threadId) await supabase.from("thread_participants").delete().eq("contact_id", run.contactId).eq("thread_id", run.threadId);
      if (fx.identity_ids?.length) await supabase.from("contact_identities").delete().in("id", fx.identity_ids);
      const patch: { relationship?: null; lead_source?: null } = {};
      if (fx.set_lead) patch.relationship = null;
      if (fx.set_source) patch.lead_source = null;
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("contacts").update(patch).eq("id", run.contactId);
        if (error) fail("Could not take the Lead mark off.");
        done.leadRemoved = true;
      }
    }
  }

  const { error } = await supabase.from("automation_runs").update({ status: "undone" }).eq("id", run.id).eq("status", "done");
  if (error) throw new Error("It was undone, but the history could not be updated.");
  return undoneText(done);
}
