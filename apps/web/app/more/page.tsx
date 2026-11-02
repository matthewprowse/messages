"use client";

// On a phone the bottom bar has room for four places, so everything else is one screen away: the things to start, the
// places that are not in the bar, and, for the owner, Analytics and Admin. The dialogs open from here the way they do from
// the rail's New menu (NewMenu stays mounted and listens for NEW_ITEM_EVENT).

import Link from "next/link";
import { CalendarPlus, ChartColumn, CircleCheck, Mail, Megaphone, MessageCircle, NotebookPen, Paperclip, Settings, ShieldCheck, type LucideIcon } from "lucide-react";
import { useIsOwner } from "@/lib/auth";
import { NEW_ITEM_EVENT } from "@/components/new-menu";
import { PaneHeader } from "@/components/pane";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const NEW_ITEMS: { item: string; label: string; icon: LucideIcon }[] = [
  { item: "email", label: "New Email", icon: Mail },
  { item: "whatsapp", label: "New WhatsApp Message", icon: MessageCircle },
  { item: "linkedin", label: "New LinkedIn Message", icon: MessageCircle },
  { item: "instagram", label: "New Instagram Message", icon: MessageCircle },
  { item: "event", label: "New Event", icon: CalendarPlus },
  { item: "task", label: "New Task", icon: CircleCheck },
];

const rowClass = "flex w-full items-center gap-3 rounded-lg p-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset";

function Icon({ icon: I }: { icon: LucideIcon }) {
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><I className="size-4" /></span>;
}

function LinkRow({ href, label, icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <Link href={href} className={rowClass}>
      <Icon icon={icon} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
    </Link>
  );
}

export default function MorePage() {
  const isOwner = useIsOwner();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0"><PaneHeader title="More" /></div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-3">
          {NEW_ITEMS.map(({ item, label, icon }) => (
            <button key={item} type="button" className={rowClass} onClick={() => window.dispatchEvent(new CustomEvent(NEW_ITEM_EVENT, { detail: item }))}>
              <Icon icon={icon} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
            </button>
          ))}
          <Separator className="my-2" />
          <LinkRow href="/notes" label="Notes" icon={NotebookPen} />
          <LinkRow href="/attachments" label="Attachments" icon={Paperclip} />
          {isOwner && (
            <>
              <Separator className="my-2" />
              <LinkRow href="/analytics" label="Analytics" icon={ChartColumn} />
              <LinkRow href="/admin" label="Admin" icon={ShieldCheck} />
            </>
          )}
          <Separator className="my-2" />
          <LinkRow href="/whats-new" label="What's New" icon={Megaphone} />
          <LinkRow href="/settings" label="Settings" icon={Settings} />
        </div>
      </ScrollArea>
    </div>
  );
}
