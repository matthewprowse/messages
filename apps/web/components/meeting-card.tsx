"use client";

// A meeting from Teams, Zoom or Google Meet as a card: where and when it was, the AI's summary and action
// items, and its transcript in a dialog with search. Shown among a conversation's messages, on a contact's
// page and on the calendar event it was.

import { MeetingNoteButton } from "@/components/note-from-meeting";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Video } from "lucide-react";
import { track } from "@/lib/analytics";
import { longDate, timeOf } from "@/lib/format";
import { hasTranscript, highlight, loadTranscript, meetingLength, searchTranscript, segmentTime, type Meeting, type TranscriptSegment } from "@/lib/meetings";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { providerLabel } from "@/components/primitives";
import { ProviderLogo } from "@/components/provider-logo";
import { useMeetings } from "@/components/meetings-data";

/** Where a card is shown, for the analytics. */
export type MeetingPlace = "conversation" | "contact" | "calendar";

/** When a meeting was, such as "Tuesday, 27 October 2026, 10:00 to 10:45". */
export function meetingWhen(m: Pick<Meeting, "startedAt" | "endedAt">) {
  const times = m.endedAt ? `${timeOf(m.startedAt)} to ${timeOf(m.endedAt)}` : timeOf(m.startedAt);
  return `${longDate(m.startedAt)}, ${times}`;
}

export function meetingTitle(m: Pick<Meeting, "title" | "platform">) {
  return m.title || `${providerLabel[m.platform]} Meeting`;
}

/** What the card says instead of a summary, while there is none. */
function statusNote(m: Meeting): { title: string; detail?: string } | null {
  switch (m.status) {
    case "waiting":
      return { title: "Transcript Not Ready Yet", detail: "The summary appears here once the transcript is in." };
    case "transcribed":
      return { title: "Summary Not Ready Yet", detail: "The transcript is in and the summary is being written." };
    case "no_transcript":
      return { title: "No Transcript, Transcription Was Off", detail: "Turn on transcription or recording for your next meeting to get a summary." };
    case "failed":
      return { title: hasTranscript(m) ? "Summary Not Available" : "Transcription Failed", detail: m.error ?? undefined };
    default:
      return m.summary || m.actionItems.length ? null : { title: "Nothing to Summarise", detail: "No one said anything that needed a summary." };
  }
}

export const MeetingCard = memo(function MeetingCard({ meeting: m, place, className }: { meeting: Meeting; place: MeetingPlace; className?: string }) {
  const [reading, setReading] = useState(false);
  const length = meetingLength(m.startedAt, m.endedAt);
  const note = statusNote(m);
  return (
    <article data-meeting-id={m.id} aria-label={`Meeting: ${meetingTitle(m)}`} className={cn("flex flex-col gap-3 rounded-lg border p-3 text-sm", className)}>
      <header className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden>
          {/* The platform's logo once there is one in public/logos; a camera until then. */}
          <ProviderLogo provider={m.platform} className="size-4" />
          <Video className="size-4 [img+&]:hidden" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{meetingTitle(m)}</div>
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            {[providerLabel[m.platform], meetingWhen(m), length].filter(Boolean).join(" · ")}
          </div>
        </div>
      </header>

      {m.summary && <p className="leading-6">{m.summary}</p>}
      {m.actionItems.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Action Items</h3>
          <ul className="list-disc space-y-1 pl-5 leading-6 marker:text-muted-foreground">
            {m.actionItems.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
      {note && (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{note.title}</span>
          {note.detail && <span className="text-muted-foreground">{note.detail}</span>}
        </div>
      )}

      {hasTranscript(m) && (
        <Button variant="secondary" className="self-start" onClick={() => setReading(true)}>View Transcript</Button>
      )}
      <MeetingNoteButton meeting={m} />
      <TranscriptDialog meeting={m} place={place} open={reading} onOpenChange={setReading} />
    </article>
  );
});

/** The speaker-labelled transcript, loaded when opened, with a search that narrows it to matching turns. */
function TranscriptDialog({ meeting: m, place, open, onOpenChange }: { meeting: Meeting; place: MeetingPlace; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    setFailed(false);
    loadTranscript(m.id).then(
      (s) => {
        if (!live) return;
        setSegments(s);
        track("meeting_transcript_opened", { platform: m.platform, where: place, status: m.status, segments: s.length });
      },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
    // A transcript does not change once written, so it loads again only for a newer status.
  }, [open, m.id, m.status, m.platform, place]);
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const shown = useMemo(() => (segments ? searchTranscript(segments, query) : []), [segments, query]);
  // A search is counted once typing has paused: its length and how many turns matched, never the words.
  const counted = useRef("");
  useEffect(() => {
    const q = query.trim();
    if (!q || !segments || counted.current === q) return;
    const t = setTimeout(() => {
      counted.current = q;
      track("meeting_transcript_searched", { len: q.length, results: shown.length });
    }, 1000);
    return () => clearTimeout(t);
  }, [query, segments, shown.length]);

  const searching = query.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="meeting_transcript" className="flex max-h-[calc(100svh-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">{meetingTitle(m)}</DialogTitle>
          <DialogDescription className="tabular-nums">{meetingWhen(m)}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          name="transcript_search"
          placeholder="Search Transcript"
          aria-label="Search Transcript"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!segments?.length}
        />
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4" role="log" aria-label="Transcript">
          {failed ? (
            <p className="py-6 text-center text-muted-foreground">The transcript did not load. Close this and try again.</p>
          ) : !segments ? (
            <div className="flex flex-col gap-4 py-1" aria-label="Loading Transcript">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : segments.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">No transcript was saved for this meeting.</p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">Nothing in the transcript matches your search.</p>
          ) : (
            <ol className="flex flex-col gap-4 py-1">
              {shown.map((s, i) => (
                <li key={`${s.startMs}-${i}`} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="font-medium">{s.speaker || "Unknown Speaker"}</span>
                    <span className="text-muted-foreground tabular-nums">{segmentTime(s.startMs)}</span>
                  </div>
                  <p className="leading-6 wrap-anywhere">
                    {searching
                      ? highlight(s.text, query).map((p, j) => (p.hit ? <mark key={j} className="rounded-sm bg-yellow-200 text-foreground dark:bg-yellow-500/40">{p.text}</mark> : <span key={j}>{p.text}</span>))
                      : s.text}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
        {searching && segments && segments.length > 0 && (
          <p className="text-xs text-muted-foreground" role="status">
            {shown.length === 1 ? "1 of" : `${shown.length} of`} {segments.length} turns match
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Meetings as a list of cards, newest first, for a contact's page and a calendar event. */
export function MeetingList({ meetings, place }: { meetings: Meeting[]; place: MeetingPlace }) {
  return (
    <div className="flex flex-col gap-3">
      {meetings.map((m) => <MeetingCard key={m.id} meeting={m} place={place} />)}
    </div>
  );
}

/** The meetings held for a calendar event, under its details. Nothing while there are none. */
export function EventMeetings({ eventId }: { eventId: string | null }) {
  const scope = useMemo(() => (eventId ? { eventId } : null), [eventId]);
  const { meetings } = useMeetings(scope);
  if (meetings.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Meetings">
      <h3 className="text-sm font-medium">{meetings.length === 1 ? "Meeting" : "Meetings"}</h3>
      <MeetingList meetings={meetings} place="calendar" />
    </section>
  );
}
