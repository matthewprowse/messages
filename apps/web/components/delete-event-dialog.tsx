"use client";

// The confirm dialog for deleting a calendar event, with a choice between one occurrence and the series. The worker does the delete;
// this reports start, done and failure back to the calendar page.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { GAVE_UP, type CalendarEvent } from "@/lib/calendar";
import { followRow } from "@/lib/follow-row";
import { supabase } from "@/lib/supabase";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";

export type DeleteScope = "occurrence" | "series";
type Row = { status: string; error: string | null };

// Not a failure: the worker may still delete it, so the event stays hidden and the page loads again later.
const GIVE_UP: Row = { status: GAVE_UP, error: null };
const finished = (r: Row) => r.status === "done" || r.status === "failed";

/**
 * Confirms deleting an event, and for a repeating one asks whether that event or the whole series goes. Once
 * confirmed the page hides the event at once (onStart) and the worker deletes it in the calendar, which takes a
 * few seconds: onDone follows when it has, or onFail with the reason when it could not, and this opens again
 * with that reason.
 */
export function DeleteEventDialog({
  target,
  calendar,
  onClose,
  onStart,
  onDone,
  onFail,
  onLate,
}: {
  /** The event to delete, with the reason an earlier try failed. Null while closed. */
  target: { event: CalendarEvent; error?: string } | null;
  /** What the account is called in the message, such as "iCloud Calendar". */
  calendar: string;
  onClose: () => void;
  onStart: (token: string, event: CalendarEvent, scope: DeleteScope) => void;
  onDone: (token: string) => void;
  onFail: (token: string, event: CalendarEvent, error: string) => void;
  /** The worker had not answered after a minute. The event may still go, so the page loads again later. */
  onLate?: (token: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  // What was last asked about stays in the dialog while it fades out.
  const last = useRef(target);
  if (target) last.current = target;
  const event = last.current?.event;
  const repeating = !!event?.seriesId;
  // Guests are told only when you sent the invitations; an event someone else invited you to just leaves your calendar.
  const tellsGuests = !!event && event.attendees.length > 0 && !event.organizer;

  const confirm = async (scope: DeleteScope) => {
    if (!event?.accountId) return;
    setBusy(true);
    const { data, error } = await supabase.from("calendar_deletes").insert({ event_id: event.id, account_id: event.accountId, scope }).select("id").single();
    setBusy(false);
    if (error || !data) {
      toast.error("Could not delete the event. Try again.");
      return;
    }
    const token = data.id;
    const outcome = followRow<Row>("calendar_deletes", token, "status, error", finished, GIVE_UP);
    onStart(token, event, scope);
    onClose();
    const result = await outcome;
    if (result.status === "done") {
      onDone(token);
      toast("Event deleted.");
    } else if (result.status === GIVE_UP.status) {
      toast("The event is still being deleted and may disappear shortly.");
      onLate?.(token);
    } else {
      onFail(token, event, result.error ?? "The event could not be deleted.");
    }
  };

  // The dialog stays open until the delete is queued, so a failure to queue can be tried again.
  const confirmOn = (scope: DeleteScope) => (e: React.MouseEvent) => {
    e.preventDefault();
    void confirm(scope);
  };

  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !busy && !open && onClose()}>
      <AlertDialogContent track="delete_event">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {event?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {repeating ? "This event repeats. Delete only this one, or every event in the series." : `It is deleted from your ${calendar}.`}
            {tellsGuests && " Its guests are told it is cancelled."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {target?.error && <p className="text-xs text-destructive">{target.error}</p>}
        <div className={DIALOG_BUTTONS}>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {repeating ? (
            <>
              <AlertDialogAction variant="secondary" disabled={busy} onClick={confirmOn("occurrence")}>Delete This Event</AlertDialogAction>
              <AlertDialogAction variant="destructive" disabled={busy} onClick={confirmOn("series")}>Delete All Events</AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction variant="destructive" disabled={busy} onClick={confirmOn("occurrence")}>
              {busy ? "Deleting" : "Delete Event"}
            </AlertDialogAction>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
