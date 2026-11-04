"use client";

// The invitation card in a conversation: an email that carries an .ics invitation (Google's, Outlook's and Apple's all
// do) shows its event with Accept, Maybe and Decline. The answer goes through the same path as the Calendar page's
// Reply buttons (lib/calendar-answer.ts), to the calendar event the invitation became. The reading and matching are in
// lib/invite.ts; this fetches the file and the event and draws the card.

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useApp } from "@/lib/store";
import { canChangeEvents, loadEvents, type CalendarEvent, type EventResponse } from "@/lib/calendar";
import { sendAnswer } from "@/lib/calendar-answer";
import { inviteAttachment, inviteWhen, matchInvite, parseInvite, type Invite } from "@/lib/invite";
import type { Attachment, Message } from "@/lib/types";
import { useStoredFile } from "@/components/attachments/use-stored-file";
import { failureToast } from "@/components/calendar/use-pending-changes";
import { RESPONSES } from "@/components/calendar/event-details";
import { Button } from "@/components/ui/button";

const DAY_MS = 86_400_000;
const CHOICES: { response: EventResponse; label: string }[] = [{ response: "accepted", label: "Accept" }, { response: "tentative", label: "Maybe" }, { response: "declined", label: "Decline" }];

/** What is known of an invitation: undefined while reading, null when the file is not one. */
function useInvite(file: Attachment): Invite | null | undefined {
  const stored = useStoredFile(file, true);
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const ready = stored?.state === "ready" ? stored.view : null;
  const missing = stored?.state === "missing" || stored?.state === "too_large";
  useEffect(() => {
    if (missing) { setInvite(null); return; }
    if (!ready) return;
    let cancelled = false;
    fetch(ready)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("not ok"))))
      .then((text) => { if (!cancelled) setInvite(parseInvite(text)); })
      .catch(() => { if (!cancelled) setInvite(null); });
    return () => { cancelled = true; };
  }, [ready, missing]);
  return invite;
}

/** The calendar event an invitation became, undefined while looking, null when the calendar does not have it (yet). */
function useInvitedEvent(invite: Invite | null | undefined, check: number): CalendarEvent | null | undefined {
  const [event, setEvent] = useState<CalendarEvent | null | undefined>(undefined);
  useEffect(() => {
    if (!invite || invite.cancelled) { setEvent(invite ? null : undefined); return; }
    let cancelled = false;
    const start = Date.parse(invite.startsAt);
    loadEvents(new Date(start - DAY_MS), new Date(start + DAY_MS), { details: true })
      .then((events) => { if (!cancelled) setEvent(matchInvite(invite, events)); })
      .catch(() => { if (!cancelled) setEvent(null); });
    return () => { cancelled = true; };
  }, [invite, check]);
  return event;
}

function InviteCardBody({ file }: { file: Attachment }) {
  const { accounts } = useApp();
  const [check, setCheck] = useState(0);
  const invite = useInvite(file);
  const found = useInvitedEvent(invite, check);
  // The answer shown meanwhile and after, over what the calendar had when it was loaded.
  const [answered, setAnswered] = useState<EventResponse | null>(null);
  const [saving, setSaving] = useState<EventResponse | null>(null);
  if (!invite) return null;

  const provider = accounts.find((a) => a.id === found?.accountId)?.provider;
  // You can answer an invitation sent to you, in a calendar that can be changed from here.
  const canAnswer = !!found && found.response != null && canChangeEvents(provider);
  const current = answered ?? (found?.response && found.response !== "needsAction" ? found.response : null);

  const answer = async (response: EventResponse) => {
    if (!found || saving) return;
    setSaving(response);
    // A repeating invitation is answered for the whole series, which is what the sender asked.
    const outcome = await sendAnswer(found, response, invite.repeats && found.seriesId ? "series" : "occurrence");
    setSaving(null);
    if (!outcome.saved) return failureToast(null, "Could not save your answer. Try again.");
    if (outcome.status === "done") setAnswered(response);
    else failureToast(outcome.error, "Your answer could not be sent.");
  };

  return (
    <div className="mt-2 flex min-w-0 flex-col gap-3 rounded-lg border bg-background p-3 text-foreground">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><CalendarDays className="size-4" /></div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="break-words text-sm font-medium">{invite.title}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{inviteWhen(invite)}</span>
          {invite.location && <span className="break-words text-xs text-muted-foreground">{invite.location}</span>}
          {invite.repeats && <span className="text-xs text-muted-foreground">Repeats</span>}
        </div>
      </div>
      {invite.cancelled ? (
        <p className="text-xs text-muted-foreground">This event was cancelled.</p>
      ) : found === undefined ? (
        <p className="text-xs text-muted-foreground">Checking your calendar</p>
      ) : canAnswer ? (
        <div className="flex flex-wrap items-center gap-2">
          {CHOICES.map((c) => (
            <Button key={c.response} variant={current === c.response ? "secondary" : "outline"} aria-pressed={current === c.response} disabled={!!saving} onClick={() => void answer(c.response)}>
              {saving === c.response ? "Saving" : c.label}
            </Button>
          ))}
        </div>
      ) : found ? (
        <p className="text-xs text-muted-foreground">{found.response ? `Your answer: ${RESPONSES[found.response] ?? found.response}. It cannot be changed from here.` : "You are not a guest of this event."}</p>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">This invitation is not in your calendar yet.</p>
          <Button variant="ghost" onClick={() => setCheck((n) => n + 1)}>Check Again</Button>
        </div>
      )}
    </div>
  );
}

/** The invitation card for a message, or nothing when it carries no .ics file or is one you sent. */
export function InviteCard({ message }: { message: Message }) {
  const file = inviteAttachment(message.attachments);
  if (!file || message.from === "me") return null;
  return <InviteCardBody file={file} />;
}
