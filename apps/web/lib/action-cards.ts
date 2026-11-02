// Action cards in the app: reading a proposal the AI stored (public.actions, args sealed), checking it again in the browser, and
// turning it into what Approve does. The AI worker validates before storing (apps/ai/ai/actions.py); this repeats the checks
// because the row is data from outside the browser. Nothing here acts: components/actions/action-card.tsx runs the existing
// paths (New Event, the task queue, the composer's attach, the template insert) only on the click. Pure, so it is unit tested.

import { freeSlots, type Busy } from "./choices";
import { suggestTimesText } from "./suggest-times";
import { dayKey } from "./dates";
import { MAX_TASK_TITLE, type TaskForm } from "./tasks";
import type { Attachment, Message } from "./types";

export type ActionKind = "book_meeting" | "create_task" | "attach_file" | "use_template";

export type ActionArgs =
  | { kind: "book_meeting"; title: string; minutes: number }
  | { kind: "create_task"; title: string; due: string | null }
  | { kind: "attach_file"; attachmentId: string; name: string }
  | { kind: "use_template"; templateId: string; title: string };

/** A proposal as the card holds it. status is what was decided; edited arguments live only in the card until approved. */
export interface ProposedAction {
  id: string;
  draftId: string;
  threadId: string;
  status: "proposed" | "approved" | "dismissed";
  args: ActionArgs;
}

export const MEETING_MINUTES = [15, 30, 45, 60, 90, 120] as const;
const MAX_TITLE = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max = MAX_TITLE) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The arguments in a sealed args column (already opened), or null when the kind is unknown or an argument is missing or wrong. */
export function parseArgs(kind: string, json: string | null | undefined): ActionArgs | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json ?? "");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  if (kind === "book_meeting") {
    const title = text(raw.title);
    const minutes = (MEETING_MINUTES as readonly unknown[]).includes(raw.minutes) ? (raw.minutes as number) : 60;
    return title ? { kind, title, minutes } : null;
  }
  if (kind === "create_task") {
    const title = text(raw.title);
    const due = typeof raw.due === "string" && DAY.test(raw.due) && !Number.isNaN(Date.parse(raw.due)) ? raw.due : null;
    return title ? { kind, title, due } : null;
  }
  if (kind === "attach_file") {
    const name = text(raw.name);
    return typeof raw.attachment_id === "string" && raw.attachment_id && name ? { kind, attachmentId: raw.attachment_id, name } : null;
  }
  if (kind === "use_template") {
    const title = text(raw.title);
    return typeof raw.template_id === "string" && raw.template_id && title ? { kind, templateId: raw.template_id, title } : null;
  }
  return null;
}

/** The sentence on the card saying what Approve will do. */
export function describe(args: ActionArgs): string {
  switch (args.kind) {
    case "book_meeting": return "Book a meeting with the people in this conversation, and add three free times to your reply.";
    case "create_task": return args.due ? "Add this task to your task list with its due date." : "Add this task to your task list.";
    case "attach_file": return "Attach this file to your reply.";
    case "use_template": return "Put this template into your reply.";
  }
}

/** The card's heading. */
export const KIND_LABEL: Record<ActionKind, string> = { book_meeting: "Book Meeting", create_task: "Create Task", attach_file: "Attach File", use_template: "Use Template" };

/** Up to three free times for a meeting of this length, from the next week of busy events. Empty when nothing is free. */
export function meetingSlots(events: Busy[], minutes: number, now: Date): Date[] {
  return freeSlots(events, now, now, minutes);
}

/** The text a Book Meeting approval adds below the reply: the same wording Suggest Times uses. */
export function slotsText(slots: Date[]): string {
  return suggestTimesText(slots);
}

/** "HH:MM" of a local time, for the New Event dialog. */
export const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** The day and time New Event opens on for a chosen slot. */
export function eventStart(slot: Date): { day: string; time: string } {
  return { day: dayKey(slot), time: clock(slot) };
}

/** The Create Task form for a card: its title and due date (all day), in the account given. Priority and notes are left unset. */
export function taskFormFor(args: { title: string; due: string | null }, accountId: string): TaskForm {
  return { title: args.title.trim().slice(0, MAX_TASK_TITLE), notes: "", accountId, date: args.due ?? "", time: "", priority: 0 };
}

/**
 * The attachment a card names, only when it belongs to this conversation and has a stored copy. A file the AI named that is not
 * one of this conversation's own is refused, so a proposal can never attach something from elsewhere.
 */
export function attachmentIn(msgs: Pick<Message, "attachments">[], id: string): Attachment | null {
  for (const m of msgs) {
    const hit = (m.attachments ?? []).find((a) => a.id === id);
    if (hit) return hit.path && !hit.notKept ? hit : null;
  }
  return null;
}

/** Proposals for one draft that are still waiting, newest first. Cards of an older draft, or already decided, are not shown. */
export function pendingFor(all: ProposedAction[], draftId: string | undefined): ProposedAction[] {
  return draftId ? all.filter((a) => a.draftId === draftId && a.status === "proposed") : [];
}
