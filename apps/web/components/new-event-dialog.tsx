"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { Tables } from "@messages/db";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import {
  buildEventRow,
  dateKey,
  defaultEventTimes,
  endsNextDay,
  MAX_GUESTS,
  needsReconnect,
  parseGuests,
  searchEmailContacts,
  shiftEnd,
  type EventField,
} from "@/lib/new-items";
import { ContactAvatar } from "@/components/primitives";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const POLL_MS = 4000; // in case a Realtime update is missed
const ITEM = "p-2";
const STEP = 15; // minutes between the times offered

/** Every time of day STEP minutes apart, plus the one already chosen when it falls between them. */
function timesWith(value: string) {
  const times = Array.from({ length: 1440 / STEP }, (_, i) => `${String(Math.floor((i * STEP) / 60)).padStart(2, "0")}:${String((i * STEP) % 60).padStart(2, "0")}`);
  return value && !times.includes(value) ? [...times, value].sort() : times;
}

function fromDateKey(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

function TimeSelect({ id, value, onChange, invalid, disabled }: { id: string; value: string; onChange: (v: string) => void; invalid: boolean; disabled: boolean }) {
  const times = useMemo(() => timesWith(value), [value]);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full tabular-nums" aria-invalid={invalid}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {times.map((t) => <SelectItem key={t} value={t} className="tabular-nums">{t}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

type Row = Pick<Tables<"calendar_outbox">, "status" | "error" | "html_link">;

function Reconnect() {
  return (
    <Alert>
      <AlertTitle>Reconnect Google to allow creating events</AlertTitle>
      <AlertDescription>
        <p>Run <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">pnpm connect:google</code> in the project folder, then try again.</p>
      </AlertDescription>
    </Alert>
  );
}

function SwitchRow({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** A new Google Calendar event. The worker creates it, then it shows on the Calendar page. */
export function NewEventDialog({ open, onOpenChange, day, guests: initialGuests = [] }: { open: boolean; onOpenChange: (open: boolean) => void; day?: string; guests?: string[] }) {
  const { accounts, contacts } = useApp();
  const account = accounts.find((a) => a.provider === "google_calendar" && a.status !== "disconnected");

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [guests, setGuests] = useState<string[]>([]);
  const [guestQuery, setGuestQuery] = useState("");
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [sendInvites, setSendInvites] = useState(true);
  const [addMeet, setAddMeet] = useState(false);
  const [checked, setChecked] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [rowId, setRowId] = useState<string | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const guestKey = initialGuests.join(",");

  // Each time it opens it starts fresh, on the day it was opened for, with whoever it was opened for.
  useEffect(() => {
    if (!open) return;
    const times = defaultEventTimes(new Date(), day);
    setTitle("");
    setDate(times.date);
    setAllDay(false);
    setStartTime(times.startTime);
    setEndTime(times.endTime);
    setLocation("");
    setDescription("");
    setGuests(parseGuests(initialGuests.join(" ")).valid);
    setGuestQuery("");
    setSendInvites(true);
    setAddMeet(false);
    setChecked(false);
    setRowId(null);
    setRow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day, guestKey]);

  // Follows the queued row until the worker has created the event or given up.
  const done = row?.status === "created" || row?.status === "failed";
  useEffect(() => {
    if (!rowId || done || !open) return;
    const id = rowId;
    const apply = (r: Row | null) => { if (r) setRow({ status: r.status, error: r.error, html_link: r.html_link }); };
    const refresh = () => supabase.from("calendar_outbox").select("status, error, html_link").eq("id", id).maybeSingle().then(({ data }) => apply(data));
    const channel = supabase
      .channel(`calendar-outbox-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calendar_outbox", filter: `id=eq.${id}` }, (payload) => apply(payload.new as Row))
      .subscribe();
    const t = setInterval(refresh, POLL_MS);
    return () => { clearInterval(t); supabase.removeChannel(channel); };
  }, [rowId, done, open]);

  const pending = parseGuests(guestQuery);
  const form = { title, date, allDay, startTime, endTime, location, description, guests, sendInvites, addMeet };
  const timeZone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; }
  }, []);
  const built = buildEventRow(form, account?.id ?? "", timeZone);
  const problem: { field: EventField; error: string } | null = built.ok ? null : built;
  const errorFor = (field: EventField) => (checked && problem?.field === field ? problem.error : null);

  const creating = queueing || (!!rowId && !done);
  const created = row?.status === "created";
  const failed = row?.status === "failed";
  const locked = creating || created;
  const reconnect = !account || (failed && needsReconnect(row?.error));
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
    if (!account || locked || problem || !built.ok) return;
    setQueueing(true);
    setRow(null);
    const { data, error } = await supabase.from("calendar_outbox").insert(built.row).select("id, status, error, html_link").single();
    setQueueing(false);
    if (error || !data) {
      setRow({ status: "failed", error: "Could not save the event. Try again.", html_link: null });
      return;
    }
    setGuests(built.row.attendees);
    setGuestQuery("");
    setRowId(data.id);
    setRow(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New Event</DialogTitle>
          <DialogDescription>Created in your Google Calendar, then shown on the Calendar page.</DialogDescription>
        </DialogHeader>
        {!account ? (
          <Reconnect />
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="grid gap-2">
              <Label htmlFor="event-title">Title</Label>
              <Input id="event-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errorFor("title")} disabled={locked} autoFocus />
              {errorFor("title") && <p className="text-xs text-destructive">{errorFor("title")}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="event-date">Date</Label>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button id="event-date" type="button" variant="outline" className="w-full justify-between font-normal" aria-invalid={!!errorFor("date")} disabled={locked}>
                    {fromDateKey(date)?.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) ?? "Pick a Date"}
                    <ChevronDownIcon className="text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDateKey(date)}
                    defaultMonth={fromDateKey(date)}
                    weekStartsOn={1}
                    captionLayout="dropdown"
                    onSelect={(d) => {
                      if (d) setDate(dateKey(d));
                      setDateOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              {errorFor("date") && <p className="text-xs text-destructive">{errorFor("date")}</p>}
            </div>
            <SwitchRow id="event-all-day" label="All Day" checked={allDay} onChange={setAllDay} disabled={locked} />
            {!allDay && (
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
            <div className="grid gap-2">
              <Label htmlFor="event-guests">Guests</Label>
              <Popover open={guestsOpen} onOpenChange={onGuestsOpen}>
                <PopoverTrigger asChild>
                  <Button id="event-guests" type="button" variant="outline" className="w-full justify-between font-normal" aria-invalid={!!errorFor("guests")} disabled={locked}>
                    <span className={guestLabel ? "truncate" : "truncate text-muted-foreground"}>{guestLabel ?? "Add Guests"}</span>
                    <ChevronDownIcon className="text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      value={guestQuery}
                      onValueChange={setGuestQuery}
                      onKeyDown={(e) => {
                        // A comma or semicolon ends an address, so several can be typed or pasted at once.
                        if ((e.key === "," || e.key === ";") && guestQuery.trim()) { e.preventDefault(); addGuests(guestQuery); }
                      }}
                      placeholder="Name or email address"
                    />
                    <CommandList className="max-h-80">
                      <CommandEmpty className="py-4 text-muted-foreground">{guestQuery.trim() ? "No contacts found." : "Type a name or email address."}</CommandEmpty>
                      {typed.length > 0 && (
                        <CommandGroup>
                          <CommandItem value={`add ${typed.join(" ")}`} className={ITEM} onSelect={() => addGuests(typed.join(" "))}>
                            <span className="min-w-0 truncate">Add {typed.join(", ")}</span>
                          </CommandItem>
                        </CommandGroup>
                      )}
                      {suggestions.length > 0 && (
                        <CommandGroup heading="Contacts">
                          {suggestions.map(({ contact, email }) => (
                            <CommandItem key={`${contact.id} ${email}`} value={`${contact.id} ${email}`} className={ITEM} onSelect={() => { addGuests(email); setGuestQuery(""); }}>
                              <ContactAvatar contact={contact} className="size-6" />
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate">{contact.name}</span>
                                <span className="truncate text-xs text-muted-foreground">{email}</span>
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                      {/* Picking a guest again takes them off. */}
                      {guests.length > 0 && !guestQuery.trim() && (
                        <CommandGroup heading="Guests">
                          {guests.map((g) => (
                            <CommandItem key={g} value={`guest ${g}`} data-checked className={ITEM} onSelect={() => setGuests((list) => list.filter((x) => x !== g))}>
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate">{nameOf(g)}</span>
                                {nameOf(g) !== g && <span className="truncate text-xs text-muted-foreground">{g}</span>}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {errorFor("guests") && <p className="text-xs text-destructive">{errorFor("guests")}</p>}
            </div>
            <SwitchRow id="event-invites" label="Send Invites" checked={sendInvites} onChange={setSendInvites} disabled={locked} />
            <SwitchRow id="event-meet" label="Add Google Meet" checked={addMeet} onChange={setAddMeet} disabled={locked} />
            <p className="text-xs text-muted-foreground">Created in Google Calendar as {account.detail}.</p>
            {failed && (reconnect ? <Reconnect /> : <p className="text-xs text-destructive">{row?.error ?? "The event could not be created."}</p>)}
            {created && <p className="text-xs text-muted-foreground">Created. It shows on the Calendar page now.</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{locked ? "Close" : "Cancel"}</Button>
              {created ? (
                row?.html_link ? (
                  <Button asChild><a href={row.html_link} target="_blank" rel="noreferrer">Open in Google Calendar</a></Button>
                ) : null
              ) : (
                <Button type="submit" disabled={locked || (checked && !!problem)}>{creating ? "Creating" : "Create"}</Button>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
