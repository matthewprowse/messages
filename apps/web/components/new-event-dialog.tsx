"use client";

// The New Event dialog, which also edits an existing event. Saving closes it at once and the worker creates or changes the event in the calendar.

import { useEffect, useMemo, useRef, useState } from "react";
import { markSubmitted } from "@/lib/analytics";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { buildUpdate, followUpdate, formOf, GAVE_UP, type CalendarEvent, type EventPatch, type UpdateScope } from "@/lib/calendar";
import { repeatOptionsFor, repeatSelectValue } from "@/lib/event-form";
import { sameRepeat } from "@/lib/recurrence";
import {
  buildEventRow,
  defaultEventTimes,
  endsNextDay,
  MAX_GUESTS,
  needsReconnect,
  parseGuests,
  pendingEvent,
  searchEmailContacts,
  shiftEnd,
  type EventField,
} from "@/lib/new-items";
import { followEvent, type Row } from "@/components/new-event/follow-event";
import { DateField, RepeatField, Reconnect, SwitchRow, TimeSelect } from "@/components/new-event/event-fields";
import { GuestPicker } from "@/components/new-event/guest-picker";
import { ScopeDialog } from "@/components/new-event/scope-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CALENDARS = ["google_calendar", "icloud_calendar"] as const;

/**
 * A new Google Calendar or iCloud Calendar event, or with `editing` a change to one. The dialog closes as soon as
 * the event is saved and calls onQueued with it, so a page showing events can show it at once. The worker then
 * creates it, which takes a few seconds: onCreated follows when it has, so the page can load the events again, or
 * onFailed when it could not, and the dialog opens again with what was typed and the reason.
 *
 * Editing works the same way with onEditQueued (the changed fields, to show meanwhile), onEditDone and
 * onEditFailed. Only what changed is sent; for a repeating event Save This Event or Save All Events sets the scope.
 */
export function NewEventDialog({
  open,
  onOpenChange,
  day,
  time,
  until,
  guests: initialGuests = [],
  onQueued,
  onCreated,
  onFailed,
  onLate,
  editing,
  onEditQueued,
  onEditDone,
  onEditFailed,
  onEditLate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day?: string;
  /** "HH:MM" to start at, with the day. The event runs an hour, or to `until`. */
  time?: string;
  /** "HH:MM" to end at, such as the end of a range dragged out in the week view. */
  until?: string;
  guests?: string[];
  onQueued?: (event: CalendarEvent) => void;
  onCreated?: (id: string) => void;
  onFailed?: (id: string) => void;
  /** The worker had not answered after a minute. The event may still appear, so the page loads again later. */
  onLate?: (id: string) => void;
  /** The event to change, with its guests, notes and link loaded. The dialog opens with its details. */
  editing?: CalendarEvent;
  onEditQueued?: (token: string, event: CalendarEvent, patch: EventPatch, scope: UpdateScope) => void;
  /** The calendar has made the change. `note` says what it did not do, when it did only part. */
  onEditDone?: (token: string, note: string | null) => void;
  onEditFailed?: (token: string, event: CalendarEvent, error: string) => void;
  onEditLate?: (token: string) => void;
}) {
  const { accounts, contacts } = useApp();
  const choices = accounts.filter((a) => (CALENDARS as readonly string[]).includes(a.provider) && a.status !== "disconnected");
  const [chosen, setChosen] = useState<string | null>(null);
  const edit = !!editing;
  const account = edit ? accounts.find((a) => a.id === editing.accountId && a.status !== "disconnected") : (choices.find((a) => a.id === chosen) ?? choices[0]);
  const google = account?.provider !== "icloud_calendar";

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  /** The rule it repeats by, or "" for none (lib/recurrence.ts). */
  const [repeat, setRepeat] = useState("");
  const [guests, setGuests] = useState<string[]>([]);
  const [guestQuery, setGuestQuery] = useState("");
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [sendInvites, setSendInvites] = useState(true);
  const [addMeet, setAddMeet] = useState(false);
  const [checked, setChecked] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [row, setRow] = useState<Row | null>(null);
  const guestKey = initialGuests.join(",");
  // Whether it is open now, for a creation that finishes after the dialog has closed or been opened again.
  const openNow = useRef(open);
  openNow.current = open;
  // Set when it opens again after a failure, so what was typed is kept.
  const keepForm = useRef(false);

  // Each time it opens it starts fresh, on the day it was opened for, with whoever it was opened for.
  useEffect(() => {
    if (!open) return;
    if (keepForm.current) {
      keepForm.current = false;
      return;
    }
    if (editing) {
      const { form: current } = formOf(editing);
      setTitle(current.title);
      setDate(current.date);
      setAllDay(current.allDay);
      setStartTime(current.startTime);
      setEndTime(current.endTime);
      setLocation(current.location);
      setDescription(current.description);
      setRepeat(current.repeat ?? "");
      setGuests(current.guests);
      setGuestQuery("");
      setSendInvites(true);
      setAddMeet(false);
      setChosen(null);
      setChecked(false);
      setRow(null);
      return;
    }
    const base = defaultEventTimes(new Date(), day);
    // A chosen hour is used as it is, on exactly the day chosen.
    const end = until && /^\d{2}:\d{2}$/.test(until) && time && until > time ? until : undefined;
    const times = time && day && /^\d{2}:\d{2}$/.test(time) ? { date: day, startTime: time, endTime: end ?? shiftEnd("00:00", "01:00", time) } : base;
    setTitle("");
    setDate(times.date);
    setAllDay(false);
    setStartTime(times.startTime);
    setEndTime(times.endTime);
    setLocation("");
    setDescription("");
    setRepeat("");
    setGuests(parseGuests(initialGuests.join(" ")).valid);
    setGuestQuery("");
    setSendInvites(true);
    setAddMeet(false);
    setChosen(null);
    setChecked(false);
    setRow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day, time, until, guestKey, editing?.id]);

  const pending = parseGuests(guestQuery);
  // Google and iCloud repeat events; Outlook's are shown, not changed, from here.
  const repeats = account?.provider === "google_calendar" || account?.provider === "icloud_calendar";
  const form = { title, date, allDay, startTime, endTime, location, description, guests, sendInvites, addMeet: addMeet && google, repeat: repeats ? repeat : "" };
  const timeZone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; }
  }, []);
  const built = buildEventRow(form, account?.id ?? "", timeZone);
  // A change is only what differs from the event; the scope is chosen by the button, so any stands in here.
  const update = editing ? buildUpdate(editing, form, "occurrence", timeZone, contacts) : null;
  const unchanged = !!update?.ok && !update.row;
  const editableTime = editing ? formOf(editing).editableTime : true;
  const repeating = !!editing?.seriesId;
  // The repeat choices for the chosen date, with the event's own rule when it is none of them.
  const repeatOptions = useMemo(() => repeatOptionsFor(date, repeat, repeating), [date, repeat, repeating]);
  const repeatValue = repeatSelectValue(repeatOptions, date, repeat, repeating);
  // A new rule is for the whole series.
  const repeatChanged = !!repeat && !sameRepeat(repeat, editing?.recurrence ?? "", editing ? new Date(editing.startsAt) : undefined);
  // Anything else changed alongside the repeat still gets the choice of this event or every one.
  const othersChanged = !!update?.ok && !!update.row && (update.row.title !== undefined || update.row.location !== undefined || update.row.description !== undefined || update.row.starts_at !== undefined || update.row.attendees !== undefined);
  const problem: { field: EventField; error: string } | null = update ? (update.ok ? null : update) : built.ok ? null : built;
  const errorFor = (field: EventField) => (checked && problem?.field === field ? problem.error : null);

  const failed = row?.status === "failed";
  // Locked only while the event is being saved; the dialog closes once it has been.
  const locked = queueing;
  const reconnect = !account || (failed && needsReconnect(row?.error));
  const hadGuests = !!editing && editing.attendees.length > 0;
  const suggestions = useMemo(() => searchEmailContacts(contacts, guestQuery, guests), [contacts, guestQuery, guests]);
  // Typed addresses that are not already a guest or offered as a contact below.
  const typed = pending.valid.filter((e) => !guests.includes(e) && !suggestions.some((s) => s.email === e));
  const nameOf = (email: string) => contacts.find((c) => c.emails.some((e) => e.toLowerCase() === email))?.name ?? email;
  const guestLabel = guests.length === 0 ? null : guests.length <= 2 ? guests.map(nameOf).join(", ") : `${nameOf(guests[0])} and ${guests.length - 1} more`;

  const addGuests = (text: string) => {
    const parsed = parseGuests(text);
    if (parsed.valid.length) setGuests((g) => [...new Set([...g, ...parsed.valid])].slice(0, MAX_GUESTS));
    setGuestQuery(parsed.invalid.join(" "));
  };

  // Closing the list keeps any whole addresses typed and drops the rest of the search.
  const onGuestsOpen = (next: boolean) => {
    if (!next) {
      addGuests(guestQuery);
      setGuestQuery("");
    }
    setGuestsOpen(next);
  };

  const onStart = (value: string) => {
    setEndTime((end) => shiftEnd(startTime, end, value));
    setStartTime(value);
  };

  const submit = async () => {
    setChecked(true);
    if (!account || locked || !built.ok) return;
    setQueueing(true);
    setRow(null);
    const { data, error } = await supabase.from("calendar_outbox").insert(built.row).select("id, status, error, html_link").single();
    setQueueing(false);
    if (error || !data) {
      setRow({ status: "failed", error: "Could not save the event. Try again.", html_link: null });
      return;
    }
    markSubmitted("new_event");
    // Saved: the page shows the event at once and the dialog closes, while the worker creates it.
    const id = data.id;
    const outcome = followEvent(id);
    onQueued?.(pendingEvent(id, built.row, date, contacts));
    onOpenChange(false);
    const result = await outcome;
    if (result.status === "created") {
      onCreated?.(id);
      toast("Event created.", result.html_link ? { action: { label: "Open", onClick: () => window.open(result.html_link!, "_blank", "noopener") } } : undefined);
      return;
    }
    if (result.status === GAVE_UP) {
      // Still with the worker: the event stays shown as saving, and the form does not open for a second try.
      toast("The event is still being created and may appear shortly.");
      onLate?.(id);
      return;
    }
    onFailed?.(id);
    if (openNow.current) {
      // Already making another event: its form is not touched, so the reason goes in a message.
      toast.error("An event could not be created. Try again.");
      return;
    }
    // Opens again with what was typed and the reason it failed.
    setRow(result);
    keepForm.current = true;
    onOpenChange(true);
  };

  // A repeating event is saved with one Save, which then asks whether this event or every one in the series changes.
  const [scopeOpen, setScopeOpen] = useState(false);
  const askScope = () => {
    setChecked(true);
    if (!editing || !account || locked || !update?.ok || !update.row) return;
    setScopeOpen(true);
  };
  const saveOn = (scope: UpdateScope) => (e: React.MouseEvent) => {
    e.preventDefault();
    setScopeOpen(false);
    void submitEdit(scope);
  };

  const submitEdit = async (scope: UpdateScope) => {
    setChecked(true);
    if (!editing || !account || locked || !update?.ok || !update.row) return;
    setQueueing(true);
    setRow(null);
    const { data, error } = await supabase.from("calendar_updates").insert({ ...update.row, scope }).select("id").single();
    setQueueing(false);
    if (error || !data) {
      setRow({ status: "failed", error: "Could not save the change. Try again.", html_link: null });
      return;
    }
    markSubmitted("edit_event");
    // Saved: the page shows the change at once and the dialog closes, while the worker makes it.
    const id = data.id;
    const outcome = followUpdate(id);
    onEditQueued?.(id, editing, update.patch, scope);
    onOpenChange(false);
    const result = await outcome;
    if (result.status === "done") {
      toast(result.error ? `Event updated. ${result.error}` : "Event updated.");
      onEditDone?.(id, result.error);
      return;
    }
    if (result.status === GAVE_UP) {
      toast("The change is still being made and may appear shortly.");
      onEditLate?.(id);
      return;
    }
    const reason = result.error ?? "The event could not be changed.";
    onEditFailed?.(id, editing, reason);
    toast.error(reason);
    if (openNow.current) return; // already editing something else: its form is not touched
    // Opens again with what was typed and the reason it failed.
    setRow({ status: "failed", error: reason, html_link: null });
    keepForm.current = true;
    onOpenChange(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track={edit ? "edit_event" : "new_event"} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{edit ? "Edit Event" : "New Event"}</DialogTitle>
          <DialogDescription>{edit ? "Changed" : "Created"} in your {google ? "Google" : "iCloud"} Calendar, then shown on the Calendar page.</DialogDescription>
        </DialogHeader>
        {!account ? (
          <Reconnect change={edit} />
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void (edit ? (repeating && (!repeatChanged || othersChanged) ? askScope() : submitEdit(repeating ? "series" : "occurrence")) : submit()); }}>
            {!edit && choices.length > 1 && (
              <div className="grid gap-2">
                <Label htmlFor="event-calendar">Calendar</Label>
                <Select value={account.id} onValueChange={setChosen} disabled={locked}>
                  <SelectTrigger id="event-calendar" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {choices.map((a) => <SelectItem key={a.id} value={a.id}>{a.label} ({a.detail})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="event-title">Title</Label>
              <Input id="event-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errorFor("title")} disabled={locked} autoFocus />
              {errorFor("title") && <p className="text-xs text-destructive">{errorFor("title")}</p>}
            </div>
            {!editableTime && <p className="text-xs text-muted-foreground">This event runs over several days. Change its time in your calendar.</p>}
            {editableTime && <DateField date={date} onChange={setDate} open={dateOpen} onOpenChange={setDateOpen} error={errorFor("date")} disabled={locked} />}
            {editableTime && <SwitchRow id="event-all-day" label="All Day" checked={allDay} onChange={setAllDay} disabled={locked} />}
            {editableTime && !allDay && (
              <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="event-start">Start</Label>
                    <TimeSelect id="event-start" value={startTime} onChange={onStart} invalid={!!errorFor("time")} disabled={locked} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="event-end">End</Label>
                    <TimeSelect id="event-end" value={endTime} onChange={setEndTime} invalid={!!errorFor("time")} disabled={locked} />
                  </div>
                </div>
                {errorFor("time") ? (
                  <p className="text-xs text-destructive">{errorFor("time")}</p>
                ) : endsNextDay(form) ? (
                  <p className="text-xs text-muted-foreground">Ends the next day.</p>
                ) : null}
              </div>
            )}
            {repeats && <RepeatField value={repeatValue} options={repeatOptions} onChange={setRepeat} repeating={repeating} repeatChanged={repeatChanged} othersChanged={othersChanged} disabled={locked} />}
            <div className="grid gap-2">
              <Label htmlFor="event-location">Location</Label>
              <Input id="event-location" value={location} onChange={(e) => setLocation(e.target.value)} aria-invalid={!!errorFor("location")} disabled={locked} />
              {errorFor("location") && <p className="text-xs text-destructive">{errorFor("location")}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="event-description">Description</Label>
              <Textarea id="event-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!!errorFor("description")} disabled={locked} className="max-h-60" />
              {errorFor("description") && <p className="text-xs text-destructive">{errorFor("description")}</p>}
            </div>
            <GuestPicker open={guestsOpen} onOpenChange={onGuestsOpen} query={guestQuery} onQuery={setGuestQuery} guests={guests} setGuests={setGuests} suggestions={suggestions} typed={typed} nameOf={nameOf} label={guestLabel} addGuests={addGuests} error={errorFor("guests")} disabled={locked} />
            {(!edit || hadGuests || guests.length > 0) && <SwitchRow id="event-invites" label={edit ? "Send Updates" : "Send Invites"} checked={sendInvites} onChange={setSendInvites} disabled={locked} />}
            {!edit && google && <SwitchRow id="event-meet" label="Add Google Meet" checked={addMeet} onChange={setAddMeet} disabled={locked} />}
            {failed && (reconnect ? <Reconnect provider={account.provider} change={edit} /> : <p className="text-xs text-destructive">{row?.error ?? (edit ? "The event could not be changed." : "The event could not be created.")}</p>)}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{locked ? "Close" : "Cancel"}</Button>
              {!edit ? (
                <Button type="submit" variant="secondary" disabled={locked || (checked && !!problem)}>{queueing ? "Creating" : "Create"}</Button>
              ) : (
                <Button type="submit" variant="secondary" disabled={locked || unchanged || (checked && !!problem)}>{queueing ? "Saving" : "Save"}</Button>
              )}
            </div>
          </form>
        )}
        <ScopeDialog open={scopeOpen} onOpenChange={setScopeOpen} saveOn={saveOn} />
      </DialogContent>
    </Dialog>
  );
}
