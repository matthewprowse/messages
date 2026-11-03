"use client";

// The Schedule button for a conversation's header: opens New Event with the people in the conversation as guests and its
// subject as the title (lib/schedule.ts). The thread header mounts it with <ScheduleButton thread={thread} />, and on
// phones hides the button and opens the same dialog from its More menu through `open` and `onOpenChange`.

import { useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { useApp } from "@/lib/store";
import { scheduleDefaults } from "@/lib/schedule";
import type { Thread } from "@/lib/types";
import { NewEventDialog } from "@/components/new-event-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ScheduleButton({ thread, className, open: openProp, onOpenChange }: { thread: Pick<Thread, "subject" | "participantIds">; className?: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { contacts } = useApp();
  const [openOwn, setOpenOwn] = useState(false);
  const open = openProp ?? openOwn;
  const setOpen = onOpenChange ?? setOpenOwn;
  const defaults = useMemo(() => scheduleDefaults(thread, contacts), [thread.subject, thread.participantIds, contacts]);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild><Button variant="ghost" size="icon" className={className} aria-label="Schedule" onClick={() => setOpen(true)}><CalendarPlus /></Button></TooltipTrigger>
        <TooltipContent>Schedule</TooltipContent>
      </Tooltip>
      <NewEventDialog open={open} onOpenChange={setOpen} title={defaults.title} guests={defaults.guests} />
    </>
  );
}
