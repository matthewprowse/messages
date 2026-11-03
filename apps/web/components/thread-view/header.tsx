// The top bar of a conversation: Back, the person (linking to their contact page), channel tabs, sharing and the More menu
// (which also holds Snooze, Remind Me If No Reply and Label). On phones Sharing, Schedule and Notes fold into the More
// menu too, so the name keeps its room.

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { refreshMyTeam } from "@/lib/share";
import { useApp } from "@/lib/store";
import type { Contact, Thread } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThreadAvatar } from "@/components/primitives";
import { ProviderLogo } from "@/components/provider-logo";
import { ShareBadge, ShareItems, useThreadShare } from "@/components/work-badge";
import { NotesChip, NotesMenuItem } from "@/components/notes-chip";
import { ScheduleButton } from "@/components/schedule-button";
import { ChannelTabs } from "@/components/thread-view/channel-tabs";
import { TriageNotes } from "@/components/triage/triage-notes";
import { LabelItems } from "@/components/labels/label-items";
import { ManageLabelsHost } from "@/components/labels/manage-labels-dialog";
import { DROPDOWN_KIT } from "@/components/snooze/menu-kit";
import { SnoozeItems } from "@/components/snooze/snooze-items";
import { useSnoozePick } from "@/components/snooze/use-snooze-pick";

interface ThreadHeaderProps {
  thread: Thread;
  primary?: Contact;
  title: string;
  subtitle?: string;
  /** The address an email came from, shown on hover over the subject. */
  address?: string;
  /** Where Back, Archive and Delete return to. */
  backHref: string;
  /** The link to another thread of this person, keeping the list's filters. */
  hrefFor: (threadId: string) => string;
  forwardable: boolean;
  /** Called after Archive or Delete from the menu: opens the next conversation or the list (replacing the address). */
  onLeave: () => void;
  onAttachments: () => void;
  onForward: () => void;
}

export function ThreadHeader({ thread, primary, title, subtitle, address, backHref, hrefFor, forwardable, onLeave, onAttachments, onForward }: ThreadHeaderProps) {
  const { contactById, pin, markRead, archive, trash, giveFeedback, setJunk, snooze, unsnooze } = useApp();
  // Snoozing the open conversation moves on, as archiving does.
  const pick = useSnoozePick((ids, action, at) => {
    if (!at) return;
    snooze(ids, at, action === "remind" ? "reminder" : "snooze");
    onLeave();
  });
  const share = useThreadShare(thread);
  const [scheduling, setScheduling] = useState(false);
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b bg-background p-3 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back">
          <Link href={backHref}><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          {/* The avatar and name open the person's contact page. */}
          {(() => {
            const who = (
              <>
                <ThreadAvatar thread={thread} contacts={contactById} className="size-8" />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{title}</span>
                    <ProviderLogo provider={thread.provider} />
                  </div>
                  {subtitle && <div className="truncate text-xs text-muted-foreground" title={address}>{subtitle}</div>}
                </div>
              </>
            );
            const cls = "flex w-fit max-w-full min-w-0 items-center gap-3";
            return primary
              ? <Link href={`/contacts/${primary.id}`} aria-label={`View ${title}`} className={cn(cls, "rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}>{who}</Link>
              : <div className={cls}>{who}</div>;
          })()}
        </div>
        <ChannelTabs thread={thread} person={primary} hrefFor={hrefFor} />
        <ShareBadge share={share} className="max-md:hidden" />
        <ScheduleButton thread={thread} className="max-md:hidden" open={scheduling} onOpenChange={setScheduling} />
        <NotesChip kind="thread" id={thread.id} title={thread.subject} className="max-md:hidden" />
        <DropdownMenu onOpenChange={(open) => open && share.shown && refreshMyTeam()}>
          <DropdownMenuTrigger asChild><Button variant="secondary" size="icon" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max">
            {/* Phones only: what sits in the header beside this menu on wider screens. */}
            <NotesMenuItem kind="thread" id={thread.id} title={thread.subject} className="md:hidden" />
            <DropdownMenuItem className="md:hidden" onSelect={() => setScheduling(true)}>Schedule</DropdownMenuItem>
            {share.shown && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="md:hidden">Sharing</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-max max-w-64"><ShareItems share={share} /></DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator className="md:hidden" />
            <DropdownMenuItem onClick={() => pin(thread.id, !thread.pinned)}>{thread.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => markRead(thread.id, thread.unread)}>{thread.unread ? "Mark as Read" : "Mark as Unread"}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { archive(thread.id); onLeave(); }}>Archive</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { trash(thread.id); onLeave(); }}>Delete</DropdownMenuItem>
            {thread.status === "inbox" && (
              <SnoozeItems kit={DROPDOWN_KIT} thread={thread} onAt={(mode, at) => pick.snoozeAt([thread.id], at, mode)} onDate={(mode) => pick.request([thread.id], mode, "date")} onUnsnooze={() => unsnooze(thread.id)} />
            )}
            <LabelItems kit={DROPDOWN_KIT} ids={[thread.id]} />
            <DropdownMenuItem onClick={() => onAttachments()}>Attachments</DropdownMenuItem>
            {forwardable && <DropdownMenuItem onClick={() => onForward()}>Forward</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => giveFeedback(thread.id, "important")}>Mark as Important</DropdownMenuItem>
            <DropdownMenuItem onClick={() => giveFeedback(thread.id, "not_important")}>Mark as Not Important</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setJunk(thread.id, !thread.junk)}>{thread.junk ? "Not Junk" : "Move to Junk"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/settings/personalisation?add=${encodeURIComponent(primary?.emails[0] ?? primary?.phones[0] ?? "")}#priorities`}>Add Priority Rule</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {pick.dialog}
      {share.dialogs}
      <TriageNotes thread={thread} />
      <ManageLabelsHost />
    </>
  );
}
