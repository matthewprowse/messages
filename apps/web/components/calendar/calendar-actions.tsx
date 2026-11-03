"use client";

// The Calendar header's actions, icons only so they fit a phone: New (a menu of New Event and New Task) and Copy Free Times.

import { CalendarPlus, Clock, ListPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconAction, Tip } from "@/components/tip";

export function CalendarActions({ onNewEvent, onNewTask, onFreeTimes }: { onNewEvent: () => void; onNewTask: () => void; onFreeTimes: () => void }) {
  return (
    <>
      {/* Not modal, so the dialog an item opens takes the focus rather than handing it back to the menu's button. */}
      <DropdownMenu modal={false}>
        <Tip label="New">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="New"><Plus /></Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="w-max">
          <DropdownMenuItem onSelect={onNewEvent}><CalendarPlus />New Event<DropdownMenuShortcut>N</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewTask}><ListPlus />New Task<DropdownMenuShortcut>Shift N</DropdownMenuShortcut></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IconAction label="Copy Free Times" icon={Clock} onClick={onFreeTimes} />
    </>
  );
}
