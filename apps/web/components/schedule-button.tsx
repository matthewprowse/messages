"use client";

// The Schedule button for a conversation's header: opens New Event with the people in the conversation as guests and its
// subject as the title (lib/schedule.ts). The thread header mounts it with <ScheduleButton thread={thread} />.

import { useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { useApp } from "@/lib/store";
import { scheduleDefaults } from "@/lib/schedule";
import type { Thread } from "@/lib/types";
import { NewEventDialog } from "@/components/new-event-dialog";
import { Button } from "@/components/ui/button";

export function ScheduleButton({ thread, className }: { thread: Pick<Thread, "subject" | "participantIds">; className?: string }) {
  const { contacts } = useApp();
  const [open, setOpen] = useState(false);
  const defaults = useMemo(() => scheduleDefaults(thread, contacts), [thread.subject, thread.participantIds, contacts]);
  return (
    <>
      <Button variant="ghost" size="icon" className={className} aria-label="Schedule" title="Schedule" onClick={() => setOpen(true)}><CalendarPlus /></Button>
      <NewEventDialog open={open} onOpenChange={setOpen} title={defaults.title} guests={defaults.guests} />
    </>
  );
}
