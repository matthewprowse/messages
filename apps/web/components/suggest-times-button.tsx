"use client";

// Suggest Times: a button in the reply box and New Email that adds three free times from your calendar to the message.
// It uses the same free-slot code as guided drafting (freeSlots in lib/choices.ts), so the times are never ones that clash.

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { loadEvents } from "@/lib/calendar";
import { freeSlots } from "@/lib/choices";
import { suggestTimesText } from "@/lib/suggest-times";
import { track } from "@/lib/analytics";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";

const WEEK_MS = 8 * 24 * 60 * 60_000; // a day more than freeSlots looks ahead, so the last day is covered

/** onInsert gets the text to add below what is in the box. Says so in a toast when the calendar cannot be read or nothing is free. */
export function SuggestTimesButton({ disabled, onInsert }: { disabled?: boolean; onInsert: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const suggest = async () => {
    setBusy(true);
    try {
      const now = new Date();
      const events = await loadEvents(now, new Date(now.getTime() + WEEK_MS));
      const text = suggestTimesText(freeSlots(events, now, now));
      if (!text) return void toast("No free times in the next week.");
      track("feature_used", { feature: "suggest_times" });
      onInsert(text);
    } catch {
      toast("Could not read your calendar. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return <Tip label="Suggest Times"><Button type="button" variant="ghost" size="icon" aria-label="Suggest Times" disabled={disabled || busy} onClick={suggest}><CalendarClock /></Button></Tip>;
}
