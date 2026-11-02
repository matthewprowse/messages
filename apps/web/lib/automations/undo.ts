// Undo for an automation run: what a run recorded (ids only, in automation_runs.effects) and the decision of how to reverse it.
// A contact the run made is deleted only when nothing else has happened to them since; otherwise the run's own marks come off
// and the person stays. Pure: undo-io.ts does the reads and writes this plans.

/** What the AI worker wrote into automation_runs.effects. Every key is optional: a step that did not run left nothing. */
export interface Effects {
  contact_created?: boolean;
  set_lead?: boolean;
  set_source?: boolean;
  identity_ids?: string[];
  linked?: boolean;
  task_update_id?: string;
  draft_id?: string;
  thread_before?: { priority: string | null; junk: boolean | null; needs_reply: boolean | null };
}

/** Read an effects value from the database JSON, keeping only well-formed parts. */
export function readEffects(raw: unknown): Effects {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const before = r.thread_before && typeof r.thread_before === "object" ? (r.thread_before as Record<string, unknown>) : null;
  return {
    contact_created: r.contact_created === true, set_lead: r.set_lead === true, set_source: r.set_source === true, linked: r.linked === true,
    identity_ids: Array.isArray(r.identity_ids) ? r.identity_ids.filter((x: unknown): x is string => typeof x === "string") : undefined,
    task_update_id: text(r.task_update_id), draft_id: text(r.draft_id),
    thread_before: before ? { priority: typeof before.priority === "string" ? before.priority : null, junk: typeof before.junk === "boolean" ? before.junk : null, needs_reply: typeof before.needs_reply === "boolean" ? before.needs_reply : null } : undefined,
  };
}

/** What else is tied to the contact besides this run's own doing. */
export interface Activity {
  /** Conversations they are in apart from the enquiry's. */
  otherThreads: number;
  /** Tasks tied to them apart from the one this run made. */
  otherTasks: number;
  /** Other runs that touched them and are not undone. */
  otherRuns: number;
  /** Drafts for them apart from the one this run made. */
  otherDrafts: number;
  /** Messages they sent. */
  messages: number;
}

/** Whether the contact can be deleted: the run made them and nothing else has happened to them. */
export function deletable(effects: Effects, a: Activity): boolean {
  return effects.contact_created === true && a.otherThreads === 0 && a.otherTasks === 0 && a.otherRuns === 0 && a.otherDrafts === 0 && a.messages === 0;
}

/** The sentence shown after an undo, from what was actually reversed. */
export function undoneText(done: { contactDeleted: boolean; leadRemoved: boolean; taskRemoved: boolean; draftRemoved: boolean; urgentRestored: boolean }): string {
  const parts = [
    done.contactDeleted ? "the contact" : done.leadRemoved ? "the Lead mark" : "",
    done.taskRemoved ? "the task" : "",
    done.draftRemoved ? "the draft" : "",
    done.urgentRestored ? "the urgent mark" : "",
  ].filter(Boolean);
  if (!parts.length) return "Undone. There was nothing left to remove.";
  return `Undone. Removed ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`}.`;
}
