// A WhatsApp call in a conversation, drawn as a centred line instead of a bubble: calls you made from your phone and calls
// to you, with how long each lasted. A missed call to you is the one that matters: it is often a client trying to reach you,
// so it is marked in the warning colour.

import { Phone, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, Video, VideoOff } from "lucide-react";
import type { Message } from "@/lib/types";
import { timeOf } from "@/lib/format";
import { cn } from "@/lib/utils";

type Call = NonNullable<Message["call"]>;

/** How long a call lasted: "45 Sec", "3 Min", "1 Hr 5 Min". */
export function callLength(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} Sec`;
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min} Min` : `${Math.floor(min / 60)} Hr${min % 60 ? ` ${min % 60} Min` : ""}`;
}

/**
 * The words on a call line: what kind of call and which way it went, then how it ended. "Missed Voice Call",
 * "Outgoing Video Call" and "No Answer", "Incoming Voice Call" and "3 Min". `mine` is whether you rang.
 */
export function callLabel(call: Call, mine: boolean): { title: string; detail?: string } {
  const kind = call.video ? "Video Call" : "Voice Call";
  if (!mine && call.missed) return { title: `Missed ${kind}` };
  if (!mine && call.declined) return { title: `Declined ${kind}` };
  const title = `${mine ? "Outgoing" : "Incoming"} ${kind}`;
  if (mine && call.missed) return { title, detail: "No Answer" };
  return { title, detail: call.seconds ? callLength(call.seconds) : undefined };
}

function callIcon(call: Call, mine: boolean) {
  if (call.video) return !mine && (call.missed || call.declined) ? VideoOff : Video;
  if (!mine && call.missed) return PhoneMissed;
  if (!mine && call.declined) return PhoneOff;
  if (mine) return PhoneOutgoing;
  return call.seconds ? PhoneIncoming : Phone;
}

export function CallLine({ m }: { m: Message }) {
  const call = m.call!;
  const mine = m.from === "me";
  const { title, detail } = callLabel(call, mine);
  const Icon = callIcon(call, mine);
  const alert = !mine && call.missed;
  return (
    <div data-message-id={m.id} className="flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground">
      <Icon className={cn("size-3.5 shrink-0", alert && "text-destructive")} aria-hidden />
      <span className={cn(alert && "text-foreground")}>{title}</span>
      {detail && (
        <>
          <span aria-hidden>·</span>
          <span>{detail}</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span>{timeOf(m.sentAt)}</span>
    </div>
  );
}
