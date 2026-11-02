// A channel as a small icon (the service's own logo for chats, a mail icon for email) and as a badge with its name: used on
// By Person rows, the person timeline's message badges and the reply channel picker.

import { Mail } from "lucide-react";
import type { Channel } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/person-timeline";
import { cn } from "@/lib/utils";
import { BrandLogo, type Brand } from "@/components/provider-logo";

const BRAND: Partial<Record<Channel, Brand>> = { whatsapp: "whatsapp", linkedin: "linkedin", instagram: "instagram" };

/** The channel's icon, decorative: its name is always written beside it or in a label. */
export function ChannelMark({ channel, className }: { channel: Channel; className?: string }) {
  const brand = BRAND[channel];
  return brand ? <BrandLogo brand={brand} className={cn("size-3.5", className)} /> : <Mail aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
}

/** The icons of the channels a person is on, in the order given. */
export function ChannelMarks({ channels }: { channels: Channel[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-label={channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ")}>
      {channels.map((c) => <ChannelMark key={c} channel={c} />)}
    </span>
  );
}
