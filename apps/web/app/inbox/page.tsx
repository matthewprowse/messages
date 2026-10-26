"use client";

import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/primitives";
import { Kbd } from "@/components/ui/kbd";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["J", "K"], label: "Next or Previous" },
  { keys: ["E"], label: "Archive" },
  { keys: ["#"], label: "Delete" },
  { keys: ["!"], label: "Move to Junk" },
  { keys: ["U"], label: "Mark as Unread" },
  { keys: ["Esc"], label: "Go Back" },
];

// With no conversation open, the right-hand pane shows the list's keyboard shortcuts.
export default function InboxIndex() {
  return (
    <EmptyState
      icon={MessageSquare}
      title="Select a Conversation"
      description="Pick one from the list to read it. These shortcuts work anywhere in the inbox."
      action={
        <dl className="grid grid-cols-[auto_auto] items-center gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="contents">
              <dt className="flex justify-end gap-1">{s.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dt>
              <dd className="text-left text-muted-foreground">{s.label}</dd>
            </div>
          ))}
        </dl>
      }
    />
  );
}
