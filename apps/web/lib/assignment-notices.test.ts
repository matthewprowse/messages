// Tests for lib/assignment-notices.ts: who is told that an owner or admin gave themselves a work chat.

import test from "node:test";
import assert from "node:assert/strict";
import { mapAssignment, noticesFor, selfAssignments, type AssignmentEntry } from "./assignment-notices";

const roles: Record<string, string> = { owner: "owner", admin: "admin", agent: "member", other: "member", inbox: "member" };
const roleOf = (id: string) => roles[id];
const entry = (over: Partial<AssignmentEntry>): AssignmentEntry => ({
  id: 1, threadId: "t1", agentId: "agent", assigneeId: "owner", assignedBy: "owner", previousAssignees: [], selfAssigned: true, assignedAt: "2026-11-03T09:00:00Z", ...over,
});

test("an owner or admin taking a chat is a notice for its agent and whoever held it", () => {
  const taken = entry({ previousAssignees: ["other"] });
  assert.deepEqual(noticesFor([taken], "agent", roleOf), [taken]);
  assert.deepEqual(noticesFor([taken], "other", roleOf), [taken]);
  assert.deepEqual(noticesFor([taken], "admin", roleOf), []);
  assert.deepEqual(noticesFor([taken], "owner", roleOf), []);
});

test("being given a chat by someone else, a member's Assign to Me and an agent's own chat are not notices", () => {
  assert.deepEqual(noticesFor([entry({ assignedBy: "owner", assigneeId: "admin", selfAssigned: false })], "agent", roleOf), []);
  assert.deepEqual(noticesFor([entry({ assigneeId: "inbox", assignedBy: "inbox" })], "agent", roleOf), []);
  assert.deepEqual(selfAssignments([entry({ assigneeId: "agent", assignedBy: "agent" })], roleOf), []);
});

test("someone no longer on the team still counts, and the newest comes first", () => {
  const old = entry({ id: 1, assigneeId: "gone", assignedBy: "gone", assignedAt: "2026-10-01T09:00:00Z" });
  const recent = entry({ id: 2, assigneeId: "admin", assignedBy: "admin", assignedAt: "2026-11-01T09:00:00Z" });
  assert.deepEqual(selfAssignments([old, recent], roleOf).map((e) => e.id), [2, 1]);
});

test("a log row maps to an entry, a missing list of earlier assignees as none", () => {
  const row = { id: 7, thread_id: "t", agent_id: null, assignee_id: "a", assigned_by: "a", previous_assignees: null as unknown as string[], self_assigned: true, assigned_at: "2026-11-03T00:00:00Z" };
  assert.deepEqual(mapAssignment(row), { id: 7, threadId: "t", agentId: null, assigneeId: "a", assignedBy: "a", previousAssignees: [], selfAssigned: true, assignedAt: "2026-11-03T00:00:00Z" });
});
