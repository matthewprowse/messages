"use client";

// An event's details and dialog, and the chip that opens it.


import { NotesChip } from "@/components/notes-chip";
import { Fragment, useContext, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { canChangeEvents, googleEventUrl, type CalendarEvent, type EventResponse } from "@/lib/calendar";
import { allDaySpanText } from "@/lib/calendar-days";
import { describeRule } from "@/lib/recurrence";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { EventMeetings } from "@/components/meeting-card";
import { EventPrep } from "@/components/prep/event-prep";

import { isDimmed, longDate, timeRange } from "./dates";
import { Now, Page } from "./page-context";

export function Attendees({ event }: { event: CalendarEvent }) {
  if (event.attendees.length === 0) return null;
  return (
    <p className="text-muted-foreground">
      {event.attendees.map((a, i) => (
        <Fragment key={a.email}>
          {i > 0 && ", "}
          {a.contactId ? (
            <Link href={`/contacts/${a.contactId}`} className="text-foreground underline-offset-2 hover:underline">{a.name}</Link>
          ) : (
            <span>{a.name}</span>
          )}
        </Fragment>
      ))}
    </p>
  );
}

export const RESPONSES: Record<string, string> = { accepted: "Accepted", tentative: "Maybe", declined: "Declined", needsAction: "Not Answered" };

/**
 * How an event repeats, in words, from its series' rule. An event the calendar gives no rule for (Outlook, or one
 * the worker has not read the rule of yet) just says that it does.
 */
export function repeatsText(e: CalendarEvent) {
  if (!e.recurrence) return "Yes";
  const words = describeRule(e.recurrence, new Date(e.startsAt));
  return words === "Repeats" ? "On a Custom Schedule" : words;
}

/** A label and what it says, in the details' two columns. */
export function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

export const YOUR_ANSWER: Record<string, EventResponse> = { accepted: "accepted", tentative: "tentative", declined: "declined" };

/** What the app knows about an opened event, and what can be done with it here. */
export function useEventState(event: CalendarEvent) {
  const { accounts } = useApp();
  const { details, detailsFailed } = useContext(Page);
  const full = details.get(event.id) ?? event;
  const loading = !full.detailed && !detailsFailed.has(event.id);
  const provider = accounts.find((a) => a.id === full.accountId)?.provider;
  return {
    full,
    loading,
    // Events still being created have no account yet.
    canDelete: canChangeEvents(provider),
    // Details of an event someone else invited you to are theirs to change; you can only answer.
    canEdit: canChangeEvents(provider) && !full.organizer && !full.pending,
    canReply: canChangeEvents(provider) && !!full.organizer && full.response != null && full.attendees.length > 0,
    link: provider === "google_calendar" ? googleEventUrl(full) : null,
  };
}

/** When an event is, as the dialog's description: its day, then its times. */
export function eventWhen(e: CalendarEvent) {
  // A conference over several days reads as its span; the days are in the text, so there is no separate time.
  const span = allDaySpanText(e);
  if (span) return span;
  const day = longDate(e.allDay ? new Date(`${e.startsAt.slice(0, 10)}T12:00:00`) : new Date(e.startsAt), undefined, true);
  return `${day}, ${timeRange(e)}`;
}

/** Everything the app has about an event, with Join for a meeting link and Reply where the calendar allows it. */
export function EventDetails({ event }: { event: CalendarEvent }) {
  const { answer, detailsFailed } = useContext(Page);
  const { full, loading, canReply } = useEventState(event);
  // Whether an answer goes to every event in the series; set per event and off until chosen, so one tap never answers more than it shows.
  const [wholeSeries, setWholeSeries] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {full.pending && <span className="text-sm text-muted-foreground">Saving</span>}
      <NotesChip kind="event" id={event.id} />
      {full.conferenceUrl && (
        <Button asChild className="self-start">
          <a href={full.conferenceUrl} target="_blank" rel="noreferrer">Join Meeting</a>
        </Button>
      )}
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-3 text-sm">
        {full.location && <Detail label="Location">{full.location}</Detail>}
        {full.calendarName && <Detail label="Calendar">{full.calendarName}</Detail>}
        {(full.seriesId || full.recurrence) && <Detail label="Repeats">{repeatsText(full)}</Detail>}
        {full.organizer && <Detail label="Organizer">{full.organizer.name}</Detail>}
        {full.response && (
          <Detail label="Reply">
            {canReply ? (
              <div className="flex flex-col gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                aria-label="Your reply"
                value={YOUR_ANSWER[full.response] ?? ""}
                disabled={loading || full.pending}
                onValueChange={(value) => value && answer(full, value as EventResponse, wholeSeries ? "series" : "occurrence")}
              >
                <ToggleGroupItem value="accepted" aria-label="Yes">Yes</ToggleGroupItem>
                <ToggleGroupItem value="tentative" aria-label="Maybe">Maybe</ToggleGroupItem>
                <ToggleGroupItem value="declined" aria-label="No">No</ToggleGroupItem>
              </ToggleGroup>
              {full.seriesId && (
                <div className="flex items-center gap-2">
                  <Switch id="reply-series" checked={wholeSeries} onCheckedChange={setWholeSeries} disabled={loading || full.pending} />
                  <Label htmlFor="reply-series" className="text-muted-foreground">Answer for Every Event in the Series</Label>
                </div>
              )}
              </div>
            ) : (
              (RESPONSES[full.response] ?? full.response)
            )}
          </Detail>
        )}
        {full.attendees.length > 0 && (
          <Detail label="Guests">
            <Attendees event={full} />
          </Detail>
        )}
        {full.description && (
          <Detail label="Notes">
            <span className="block max-h-40 overflow-y-auto whitespace-pre-line">{full.description}</span>
          </Detail>
        )}
      </dl>
      {loading && (
        <div className="flex flex-col gap-2" aria-label="Loading details">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {!full.detailed && detailsFailed.has(event.id) && <p className="text-sm text-muted-foreground">Guests and notes did not load.</p>}
      <EventPrep eventId={full.pending ? null : full.id} />
      <EventMeetings eventId={full.pending ? null : full.id} />
    </div>
  );
}

/**
 * An event's details in a dialog, from any view and on any screen: Edit, Delete and the link to the calendar in
 * its button row, where the calendar allows them.
 */
export function EventDialog({ event, onClose }: { event: CalendarEvent | null; onClose: () => void }) {
  // The last event stays drawn while the dialog animates closed.
  const last = useRef<CalendarEvent | null>(null);
  if (event) last.current = event;
  const shown = event ?? last.current;
  return (
    <Dialog open={!!event} onOpenChange={(open) => !open && onClose()}>
      <DialogContent track="event_details" showCloseButton={false} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        {shown && <EventDialogBody event={shown} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

export function EventDialogBody({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { askToDelete, askToEdit } = useContext(Page);
  const { full, loading, canDelete, canEdit, link } = useEventState(event);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-words">{full.title}</DialogTitle>
        <DialogDescription className="tabular-nums">{eventWhen(full)}</DialogDescription>
      </DialogHeader>
      <EventDetails event={event} />
      <div className={DIALOG_BUTTONS}>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {link && (
          <Button variant="ghost" asChild>
            <a href={link} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a>
          </Button>
        )}
        {canDelete && <Button variant="ghost" disabled={loading} onClick={() => { onClose(); askToDelete(full); }}>Delete</Button>}
        {canEdit && <Button variant="secondary" disabled={loading || !full.detailed} onClick={() => { onClose(); askToEdit(full); }}>Edit</Button>}
      </div>
    </>
  );
}

/** An event in the week grid; clicking it shows everything about it. */
export function EventChip({ event, day, className, style, children }: { event: CalendarEvent; day: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const { setOpenKey } = useContext(Page);
  const now = useContext(Now);
  const faded = event.pending || isDimmed(event, now);
  return (
    <button
      type="button"
      onClick={() => setOpenKey(`${event.id}|${day}`)}
      style={style}
      className={cn("min-w-0 overflow-hidden rounded-md bg-secondary text-left text-xs text-secondary-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50", faded && "opacity-60", className)}
    >
      {children}
    </button>
  );
}
