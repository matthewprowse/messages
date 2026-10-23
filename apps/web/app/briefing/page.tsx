"use client";

import { Newspaper } from "lucide-react";
import { EmptyState } from "@/components/primitives";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

export default function BriefingIndex() {
  return (
    <div className="hidden h-full items-center justify-center md:flex">
      <EmptyState
        icon={Newspaper}
        title="Your Day at a Glance"
        description="Replies waiting on you, urgent conversations and today's events. Open one to read and reply."
        action={
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><KbdGroup><Kbd>J</Kbd><Kbd>K</Kbd></KbdGroup> Navigate</span>
            <span className="flex items-center gap-1.5"><Kbd>E</Kbd> Archive</span>
          </div>
        }
      />
    </div>
  );
}
