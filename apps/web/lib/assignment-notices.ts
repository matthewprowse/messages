// Which entries of the assignment log (thread_assignment_log, migration 20261124140000) someone is told about: an owner or
// admin who gave themselves a work chat that is not their own. Pure, so it is tested apart from Supabase; the loading is
// in assignment-log.ts. Ids and times only: the log holds no content.

import type { Tables } from "@messages/db";

/** One assignment of a work chat, as the log keeps it. */
export interface AssignmentEntry {
  id: number;
  threadId: string;
  /** The chat's agent, or null when they have gone. */
  agentId: string | null;
  assigneeId: string;
  assignedBy: string | null;
  /** Who else held the chat when it was assigned. */
  previousAssignees: string[];
  selfAssigned: boolean;
  assignedAt: string;
}

export type AssignmentRow = Pick<Tables<"thread_assignment_log">, "id" | "thread_id" | "agent_id" | "assignee_id" | "assigned_by" | "previous_assignees" | "self_assigned" | "assigned_at">;

export const ASSIGNMENT_COLUMNS = "id, thread_id, agent_id, assignee_id, assigned_by, previous_assignees, self_assigned, assigned_at";

export function mapAssignment(r: AssignmentRow): AssignmentEntry {
  return { id: r.id, threadId: r.thread_id, agentId: r.agent_id, assigneeId: r.assignee_id, assignedBy: r.assigned_by, previousAssignees: r.previous_assignees ?? [], selfAssigned: r.self_assigned, assignedAt: r.assigned_at };
}

/**
 * Owners and admins giving themselves someone else's chat, newest first. A member taking a shared inbox chat with Assign
 * to Me is ordinary work, so only the roles that can take any chat count. roleOf answers from the team list; a person no
 * longer in it counts, since they may have been an owner or admin when they did it.
 */
export function selfAssignments(entries: AssignmentEntry[], roleOf: (userId: string) => string | null | undefined): AssignmentEntry[] {
  return entries
    .filter((e) => e.selfAssigned && e.assigneeId !== e.agentId && ["owner", "admin", undefined, null].includes(roleOf(e.assigneeId)))
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
}

/** The self-assignments that concern me: of my own chat, or of a chat I held at the time, by someone else. */
export function noticesFor(entries: AssignmentEntry[], me: string, roleOf: (userId: string) => string | null | undefined): AssignmentEntry[] {
  return selfAssignments(entries, roleOf).filter((e) => e.assigneeId !== me && (e.agentId === me || e.previousAssignees.includes(me)));
}

/** "3 Nov 2026", the date a notice gives. */
export const noticeDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
