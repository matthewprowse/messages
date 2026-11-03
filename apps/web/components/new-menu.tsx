"use client";

// The New button in the rail and its menu of things to create. Each dialog loads on first use. Also the keyboard helpers other shortcuts use.

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SquarePen } from "lucide-react";
import { useApp } from "@/lib/store";
import { whatsappLinked } from "@/lib/new-items";
import { Button } from "@/components/ui/button";
import { RAIL_ITEM, RAIL_LABEL, RAIL_TIP } from "@/components/rail-item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Item = "email" | "whatsapp" | "linkedin" | "instagram" | "event" | "task";

// Each dialog's code (the event one pulls in the date picker) loads the first time it is opened.
const ComposeDialog = dynamic(() => import("@/components/compose-dialog").then((m) => m.ComposeDialog), { ssr: false });
const NewWhatsAppDialog = dynamic(() => import("@/components/new-whatsapp-dialog").then((m) => m.NewWhatsAppDialog), { ssr: false });
const NewLinkedInDialog = dynamic(() => import("@/components/new-linkedin-dialog").then((m) => m.NewLinkedInDialog), { ssr: false });
const NewInstagramDialog = dynamic(() => import("@/components/new-instagram-dialog").then((m) => m.NewInstagramDialog), { ssr: false });
const NewEventDialog = dynamic(() => import("@/components/new-event-dialog").then((m) => m.NewEventDialog), { ssr: false });
const NewTaskDialog = dynamic(() => import("@/components/new-task-dialog").then((m) => m.NewTaskDialog), { ssr: false });

/**
 * True when a key press belongs to a field, menu or dialog rather than to the page, including while an
 * input method is composing a character. Page shortcuts (C here, E and U in a conversation) skip these.
 */
export function isTypingKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (e.isComposing || el?.isContentEditable) return true;
  return !!el?.closest?.("input, textarea, select, [role=menu], [role=dialog], [role=listbox], [role=combobox]");
}

/** Other parts of the app (the search palette) open a new-item dialog by dispatching this event on window. */
export const NEW_ITEM_EVENT = "konva:new-item";

/** The rail's New button: a menu of new things to start, opened with C anywhere outside a field. */
export function NewMenu() {
  const { accounts } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpenItem] = useState<Item | null>(null);
  // A dialog stays mounted once opened, so closing it still animates.
  const [used, setUsed] = useState<Set<Item>>(() => new Set());
  const setOpen = (item: Item | null) => {
    setOpenItem(item);
    if (item) setUsed((prev) => (prev.has(item) ? prev : new Set(prev).add(item)));
  };
  const trigger = useRef<HTMLButtonElement>(null);
  const linked = whatsappLinked(accounts);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "c" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
      if (isTypingKey(e) || open) return;
      // On phones the rail steps aside in a conversation, and a menu with nothing to hang from is no use.
      if (!trigger.current || trigger.current.offsetParent === null) return;
      e.preventDefault();
      setMenuOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    function onNew(e: Event) {
      const item = (e as CustomEvent<Item>).detail;
      if (item === "email" || item === "whatsapp" || item === "linkedin" || item === "instagram" || item === "event" || item === "task") setOpen(item);
    }
    window.addEventListener(NEW_ITEM_EVENT, onNew);
    return () => window.removeEventListener(NEW_ITEM_EVENT, onNew);
    // setOpen only touches state setters, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (item: Item) => (value: boolean) => setOpen(value ? item : null);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button ref={trigger} variant={menuOpen || open ? "secondary" : "ghost"} size="icon" className={RAIL_ITEM} aria-label="New">
                <SquarePen />
                <span className={RAIL_LABEL}>New</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" className={RAIL_TIP}>New</TooltipContent>
        </Tooltip>
        {/* When an item opens a dialog, focus must go to the dialog, not back to this button, or Esc and Tab miss it. */}
        <DropdownMenuContent side="right" align="start" className="w-max min-w-48" onCloseAutoFocus={(e) => { if (open) e.preventDefault(); }}>
          <DropdownMenuItem onSelect={() => setOpen("email")}>New Email</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("whatsapp")}>
            {linked ? "New WhatsApp Message" : (
              <span className="flex flex-col">
                <span>New WhatsApp Message</span>
                <span className="text-xs text-muted-foreground">Link WhatsApp first</span>
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("linkedin")}>New LinkedIn Message</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("instagram")}>New Instagram Message</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("event")}>New Event</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("task")}>New Task</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {used.has("email") && <ComposeDialog open={open === "email"} onOpenChange={set("email")} />}
      {used.has("whatsapp") && <NewWhatsAppDialog open={open === "whatsapp"} onOpenChange={set("whatsapp")} />}
      {used.has("linkedin") && <NewLinkedInDialog open={open === "linkedin"} onOpenChange={set("linkedin")} />}
      {used.has("instagram") && <NewInstagramDialog open={open === "instagram"} onOpenChange={set("instagram")} />}
      {used.has("event") && <NewEventDialog open={open === "event"} onOpenChange={set("event")} />}
      {used.has("task") && <NewTaskDialog open={open === "task"} onOpenChange={set("task")} />}
    </>
  );
}
