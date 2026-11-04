"use client";

// The line in a shared chat that tells its agent, or someone who held it, that an owner or admin gave themselves access to
// it (thread_assignment_log). Shown under the access line, newest first, so taking a chat is never silent.

import { useAssignmentLog } from "@/lib/assignment-log";
import { noticeDate, noticesFor } from "@/lib/assignment-notices";
import { useAuth } from "@/lib/auth";
import { useTeam } from "@/lib/team";

/** One line per time someone gave themselves this chat, for the people it concerns. Nothing until the team has loaded. */
export function AssignmentNotices({ threadId }: { threadId: string }) {
  const me = useAuth().session?.user.id;
  const entries = useAssignmentLog(threadId);
  const { state } = useTeam();
  if (!me || !entries || !state) return null;
  const person = (id: string) => state.people.find((p) => p.userId === id);
  const notices = noticesFor(entries, me, (id) => person(id)?.role);
  if (notices.length === 0) return null;
  return (
    <div className="shrink-0 border-b bg-muted/50 px-3 py-2 text-sm md:px-4">
      {notices.slice(0, 3).map((e) => (
        <p key={e.id}>{person(e.assigneeId)?.name || person(e.assigneeId)?.email || "Someone"} Gave Themselves Access To This Chat <span className="text-muted-foreground">{noticeDate(e.assignedAt)}</span></p>
      ))}
    </div>
  );
}
