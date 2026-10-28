"use client";

// The decision buttons above the reply box, offered when triage found a choice only the user can make. Used by thread-view.tsx.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Decision, Message, Thread } from "@/lib/types";
import { clashes, freeSlots, loadChoices, otherTimeDecision, slotButton, slotLabel, type Busy, type ReplyChoices } from "@/lib/choices";
import { loadEvents } from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";

const DAY = 24 * 60 * 60_000;

/**
 * Guided drafting: when the latest message needs a decision only you can make, the choices triage
 * offered for it, as buttons above the reply box. Picking one asks for a draft that says it. An
 * availability question is checked against your calendar, and Suggest Another Time offers free times.
 */
export function GuidedChoices({ thread, msgs, disabled, onPick }: { thread: Thread; msgs: Message[]; disabled: boolean; onPick: (decision: Decision) => void }) {
  // Only while the conversation is waiting on you: its latest message is someone else's.
  const latest = msgs.at(-1);
  const waiting = latest && latest.from !== "me" && !latest.sendState && !thread.junk ? latest : undefined;
  const [choices, setChoices] = useState<{ id: string; value: ReplyChoices | null } | null>(null);
  const [events, setEvents] = useState<Busy[] | null>(null);
  const [picking, setPicking] = useState(false);

  // Read again when triage updates the conversation (its summary), as that is when choices arrive.
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    loadChoices(waiting.id).then(
      (value) => { if (live) setChoices({ id: waiting.id, value }); },
      () => { if (live) setChoices({ id: waiting.id, value: null }); },
    );
    return () => { live = false; };
  }, [waiting?.id, thread.summary, thread.needsReply]);

  const value = waiting && choices?.id === waiting.id ? choices.value : null;
  const wantsCalendar = !!value && (!!value.asked || value.options.some((o) => o.kind === "other_time"));
  useEffect(() => {
    setPicking(false);
    setEvents(null);
    if (!wantsCalendar || !value) return;
    let live = true;
    const from = new Date(Math.max(value.asked?.getTime() ?? 0, Date.now()) - DAY);
    void loadEvents(from, new Date(from.getTime() + 9 * DAY)).then(
      (found) => { if (live) setEvents(found); },
      () => { if (live) setEvents(null); },
    );
    return () => { live = false; };
  }, [value, wantsCalendar]);

  // The options offered, once for each message that has them.
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!waiting || !value || value.options.length === 0 || shownFor.current === waiting.id) return;
    shownFor.current = waiting.id;
    track("choice_shown", { count: value.options.length, kinds: value.options.map((o) => o.kind) });
  }, [waiting, value]);
  const pick = (decision: Decision) => {
    track("choice_tapped", { kind: decision.kind });
    onPick(decision);
  };

  const minutes = value?.minutes ?? 60;
  const busy = useMemo(() => (value?.asked && events ? clashes(events, value.asked, new Date(value.asked.getTime() + minutes * 60_000)) : []), [value, events, minutes]);
  const slots = useMemo(() => (picking && value ? freeSlots(events ?? [], value.asked ?? new Date(), new Date(), minutes) : []), [picking, value, events, minutes]);

  if (!value) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {value.asked && events && (
        <p className="text-xs text-muted-foreground">
          {busy.length
            ? `You have ${busy[0].title} then (${slotLabel(value.asked)}).`
            : `Your calendar is free on ${slotLabel(value.asked)}.`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {picking ? (
          <>
            {slots.map((slot) => (
              <Button key={slot.toISOString()} variant="secondary" disabled={disabled} onClick={() => pick({ text: otherTimeDecision(slot, value.asked), kind: "other_time" })}>
                {slotButton(slot)}
              </Button>
            ))}
            {!slots.length && <span className="text-xs text-muted-foreground">No free times in the next week.</span>}
            <Button variant="ghost" disabled={disabled} onClick={() => setPicking(false)}>Back</Button>
          </>
        ) : (
          value.options.map((o) => (
            <Button key={o.label} variant="secondary" disabled={disabled} onClick={() => (o.kind === "other_time" ? setPicking(true) : pick({ text: o.decision, kind: o.kind }))}>
              {o.label}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
