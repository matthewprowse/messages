// The row above a person's reply box that says where the reply goes: one button per channel they are on, the one their last
// message came in on chosen to begin with. The reply box under it is the ordinary one for that conversation.

import type { Thread } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/person-timeline";
import { Button } from "@/components/ui/button";
import { ChannelMark } from "@/components/person/channel-mark";

export function ReplyChannel({ options, target, onPick }: { options: Thread[]; target: Thread; onPick: (t: Thread) => void }) {
  if (options.length < 2) return null;
  return (
    <nav aria-label="Reply On" className="flex shrink-0 items-center gap-1 border-t bg-background px-3 pt-2 md:px-4">
      <span className="mr-1 text-xs text-muted-foreground">Reply On</span>
      {options.map((t) => (
        <Button key={t.id} type="button" size="sm" variant={t.channel === target.channel ? "secondary" : "ghost"} aria-pressed={t.channel === target.channel} className="gap-1.5 px-2" onClick={() => onPick(t)}>
          <ChannelMark channel={t.channel} />{CHANNEL_LABEL[t.channel] ?? "Chat"}
        </Button>
      ))}
    </nav>
  );
}
