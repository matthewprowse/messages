"use client";

import { useState } from "react";
import { toast } from "sonner";
import { dismissSuggestion, useMyTeam } from "@/lib/share";
import type { Thread } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { MarkWorkDialog, MovePersonalDialog } from "@/components/share-dialog";

/**
 * A line under a conversation's header for the agent only. A chat the team's rule shared tells them why, with a way
 * back; a personal chat Konva thinks is about work (a team client, or the AI's work category) offers to share it.
 * Nothing is shared until they accept, and the database changes first, so what is chosen shows at once over Realtime.
 */
export function ShareNotice({ thread }: { thread: Pick<Thread, "id" | "workspaceId" | "sharedBy" | "shareMatch" | "shareSuggestion"> }) {
  const team = useMyTeam();
  const [marking, setMarking] = useState(false);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!team) return null;

  const ruleShared = !!thread.workspaceId && thread.sharedBy === "rule";
  const suggested = !thread.workspaceId && thread.shareSuggestion === "suggested";
  if (!ruleShared && !suggested) return null;
  const canMove = !team.strict || team.role === "owner" || team.role === "admin";

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2 md:px-4">
      <p className="min-w-0 text-sm">
        {ruleShared
          ? `Shared because ${thread.shareMatch || "this person"} is a team client.`
          : thread.shareMatch
            ? `${thread.shareMatch} is a team client. Share this chat with your team?`
            : "This looks like a work chat. Share it with your team?"}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {ruleShared ? (
          <Button variant="outline" size="sm" disabled={!canMove} onClick={() => setMoving(true)}>Move to Personal</Button>
        ) : (
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
              setBusy(true);
              const problem = await dismissSuggestion(thread.id);
              setBusy(false);
              if (problem) toast.error(problem);
            }}>Not Work</Button>
            <Button size="sm" disabled={busy} onClick={() => setMarking(true)}>Mark as Work</Button>
          </>
        )}
      </div>
      <MarkWorkDialog threadId={thread.id} open={marking} strict={team.strict} suggested onOpenChange={setMarking} onDone={() => undefined} />
      <MovePersonalDialog threadId={thread.id} open={moving} onOpenChange={setMoving} onDone={() => undefined} />
    </div>
  );
}
