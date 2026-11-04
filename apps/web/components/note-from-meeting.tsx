"use client";

// Create Note From Summary: an editable note from a meeting's summary and action items, linked to its calendar event
// and its attendees' contacts (lib/note-meeting.ts). No AI call. Mount <MeetingNoteButton meeting={m} /> in the
// meeting card's actions; it renders nothing while the meeting has no summary or action items.

import { NotebookPen } from "lucide-react";
import { shortDate } from "@/lib/note-templates";
import { canNoteMeeting, meetingNote } from "@/lib/note-meeting";
import type { Meeting } from "@/lib/meetings";
import { useCaptureNote } from "@/components/note-capture";
import { Button } from "@/components/ui/button";

/** Returns a function that makes the note for this meeting and opens it. */
export function useMeetingNote() {
  const capture = useCaptureNote();
  return (m: Meeting) => capture(meetingNote(m, shortDate(new Date(m.startedAt))));
}

export function MeetingNoteButton({ meeting, className }: { meeting: Meeting; className?: string }) {
  const make = useMeetingNote();
  if (!canNoteMeeting(meeting)) return null;
  return <Button variant="secondary" className={className} onClick={() => void make(meeting)}><NotebookPen />Create Note From Summary</Button>;
}
