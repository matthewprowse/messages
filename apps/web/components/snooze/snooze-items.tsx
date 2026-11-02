"use client";

// The Snooze and Remind Me If No Reply entries of a conversation's menu (header More menu or a row's right-click menu).
// Ready-made times snooze at once; Pick a Date opens the dialog. Mounted only while the menu is open, so the times are fresh.

import { reminderChoices, snoozeChoices } from "@/lib/snooze";
import type { Thread } from "@/lib/types";
import type { SnoozeRequest } from "./snooze-dialog";
import type { MenuKit } from "./menu-kit";

interface Props {
  kit: MenuKit;
  thread: Pick<Thread, "snoozedUntil" | "lastFromMe" | "status">;
  /** Ready-made time chosen. */
  onAt: (mode: SnoozeRequest["mode"], at: Date) => void;
  /** Pick a Date chosen: open the dialog on its calendar. */
  onDate: (mode: SnoozeRequest["mode"]) => void;
  onUnsnooze: () => void;
}

export function SnoozeItems({ kit: { Item, Sub, SubTrigger, SubContent }, thread, onAt, onDate, onUnsnooze }: Props) {
  const now = new Date();
  const snoozed = !!thread.snoozedUntil && Date.parse(thread.snoozedUntil) > now.getTime();
  // Only a conversation you wrote last waits on an answer.
  const canRemind = thread.lastFromMe && thread.status === "inbox";
  return (
    <>
      {snoozed && <Item onSelect={onUnsnooze}>Unsnooze</Item>}
      <Sub>
        <SubTrigger>Snooze</SubTrigger>
        <SubContent>
          {snoozeChoices(now).map((c) => <Item key={c.key} onSelect={() => onAt("snooze", c.at)}>{c.label}</Item>)}
          <Item onSelect={() => onDate("snooze")}>Pick a Date</Item>
        </SubContent>
      </Sub>
      {canRemind && (
        <Sub>
          <SubTrigger>Remind Me If No Reply</SubTrigger>
          <SubContent>
            {reminderChoices(now).map((c) => <Item key={c.key} onSelect={() => onAt("remind", c.at)}>{c.label}</Item>)}
            <Item onSelect={() => onDate("remind")}>Pick a Date</Item>
          </SubContent>
        </Sub>
      )}
    </>
  );
}
