"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { refreshMyTeam, useMyTeam, useSharing } from "@/lib/share";
import type { Thread } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MarkWorkDialog, MovePersonalDialog } from "@/components/share-dialog";

/**
 * A chat's Work or Personal badge, for the list. Only shown to someone in a team, or on a chat that is shared (so
 * a member who has left still sees which of their chats the team keeps).
 */
export function WorkTag({ thread }: { thread: Pick<Thread, "workspaceId"> }) {
  const team = useMyTeam();
  if (!thread.workspaceId && !team) return null;
  return <Badge variant={thread.workspaceId ? "secondary" : "outline"}>{thread.workspaceId ? "Work" : "Personal"}</Badge>;
}

/**
 * The badge in a conversation's header, which opens the choices: Mark as Work for a personal chat, Move to Personal
 * for a work chat. Under strict sharing only an owner or admin can move one back, and it says so.
 */
export function ThreadShare({ thread }: { thread: Pick<Thread, "id" | "workspaceId"> }) {
  const team = useMyTeam();
  const shared = !!thread.workspaceId;
  // The database changes first and the chat's row follows over Realtime, so what was just chosen shows at once.
  const [chosen, setChosen] = useState<"work" | "personal" | null>(null);
  useEffect(() => setChosen(null), [thread.workspaceId, thread.id]);
  const work = chosen ? chosen === "work" : shared;
  const { sharing, check } = useSharing(thread.id, work);
  const [marking, setMarking] = useState(false);
  const [moving, setMoving] = useState(false);

  if (!team && !shared) return null;
  const canMove = !!team && (!team.strict || team.role === "owner" || team.role === "admin");
  const label = work ? (sharing ? "Sharing" : "Work") : "Personal";

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && refreshMyTeam()}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`${label}. Change whether this chat is shared`} className="shrink-0 rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Badge variant={work ? "secondary" : "outline"}>{label}<ChevronDown /></Badge>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max max-w-64">
          {work ? (
            <>
              <DropdownMenuItem disabled={!canMove} onSelect={() => setMoving(true)}>Move to Personal</DropdownMenuItem>
              {!canMove && (
                <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                  {team ? "Strict sharing keeps work chats shared. Only an owner or admin can release one." : "You are no longer in this team."}
                </p>
              )}
            </>
          ) : (
            <DropdownMenuItem disabled={!team} onSelect={() => setMarking(true)}>Mark as Work</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <MarkWorkDialog threadId={thread.id} open={marking} strict={!!team?.strict} onOpenChange={setMarking} onDone={() => { setChosen("work"); void check(); }} />
      <MovePersonalDialog threadId={thread.id} open={moving} onOpenChange={setMoving} onDone={() => setChosen("personal")} />
    </>
  );
}
