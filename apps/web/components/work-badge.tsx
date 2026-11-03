"use client";

// The Work or Personal badge on the conversation list and in the conversation header, and the menu that moves a chat between them.

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { refreshMyTeam, useMyTeam, useSharing } from "@/lib/share";
import type { Thread } from "@/lib/types";
import { cn } from "@/lib/utils";
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

/** Whether a conversation is work or personal, and the dialogs that move it. The header reads it once for its badge and its phone menu. */
export function useThreadShare(thread: Pick<Thread, "id" | "workspaceId">) {
  const team = useMyTeam();
  const shared = !!thread.workspaceId;
  // The database changes first and the chat's row follows over Realtime, so what was just chosen shows at once.
  const [chosen, setChosen] = useState<"work" | "personal" | null>(null);
  useEffect(() => setChosen(null), [thread.workspaceId, thread.id]);
  const work = chosen ? chosen === "work" : shared;
  const { sharing, check } = useSharing(thread.id, work);
  const [marking, setMarking] = useState(false);
  const [moving, setMoving] = useState(false);
  const canMove = !!team && (!team.strict || team.role === "owner" || team.role === "admin");
  const dialogs = (
    <>
      <MarkWorkDialog threadId={thread.id} open={marking} strict={!!team?.strict} onOpenChange={setMarking} onDone={() => { setChosen("work"); void check(); }} />
      <MovePersonalDialog threadId={thread.id} open={moving} onOpenChange={setMoving} onDone={() => setChosen("personal")} />
    </>
  );
  return {
    team,
    /** Only someone in a team, or a chat that is shared, sees any of this. */
    shown: !!team || shared,
    work,
    canMove,
    label: work ? (sharing ? "Sharing" : "Work") : "Personal",
    mark: () => setMarking(true),
    move: () => setMoving(true),
    dialogs,
  };
}

type ShareState = ReturnType<typeof useThreadShare>;

/** The choices for the chat: Mark as Work, or Move to Personal with why it may be locked. Inside any dropdown menu. */
export function ShareItems({ share, className }: { share: ShareState; className?: string }) {
  if (!share.work) return <DropdownMenuItem className={className} disabled={!share.team} onSelect={share.mark}>Mark as Work</DropdownMenuItem>;
  return (
    <>
      <DropdownMenuItem className={className} disabled={!share.canMove} onSelect={share.move}>Move to Personal</DropdownMenuItem>
      {!share.canMove && (
        <p className={cn("px-2 pb-1.5 text-xs text-muted-foreground", className)}>
          {share.team ? "Strict sharing keeps work chats shared. Only an owner or admin can release one." : "You are no longer in this team."}
        </p>
      )}
    </>
  );
}

/**
 * The badge in a conversation's header, which opens the choices: Mark as Work for a personal chat, Move to Personal
 * for a work chat. Under strict sharing only an owner or admin can move one back, and it says so. The dialogs are the
 * caller's to mount (share.dialogs), so the phone menu can open them too.
 */
export function ShareBadge({ share, className }: { share: ShareState; className?: string }) {
  if (!share.shown) return null;
  return (
    <DropdownMenu onOpenChange={(open) => open && refreshMyTeam()}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`${share.label}. Change whether this chat is shared`} className={cn("shrink-0 rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
          <Badge variant={share.work ? "secondary" : "outline"}>{share.label}<ChevronDown /></Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max max-w-64">
        <ShareItems share={share} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
