// A WhatsApp call in a conversation, drawn as a centred line instead of a bubble. A missed call is the one that matters: it is
// often a client trying to reach you, so it is marked in the warning colour.

import { Phone, PhoneMissed, Video, VideoOff } from "lucide-react";
import type { Message } from "@/lib/types";
import { timeOf } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Missed Voice Call", "Video Call" and so on, from the call's kind and outcome. */
export function callLabel(call: NonNullable<Message["call"]>): string {
  return `${call.missed ? "Missed " : ""}${call.video ? "Video" : "Voice"} Call`;
}

export function CallLine({ m }: { m: Message }) {
  const call = m.call!;
  const Icon = call.missed ? (call.video ? VideoOff : PhoneMissed) : call.video ? Video : Phone;
  return (
    <div data-message-id={m.id} className="flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground">
      <Icon className={cn("size-3.5 shrink-0", call.missed && "text-destructive")} aria-hidden />
      <span>{callLabel(call)}</span>
      <span aria-hidden>·</span>
      <span>{timeOf(m.sentAt)}</span>
    </div>
  );
}
