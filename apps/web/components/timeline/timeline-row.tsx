"use client";

// One entry of a client timeline: a type icon (the channel's own icon for a message), the title as a link to its source, a second
// line, the time, the matters that hold it and a menu to put it in a matter.

import Link from "next/link";
import { CheckSquare, FileText, Handshake, Plus, StickyNote, UserPlus, Video, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChannelMark } from "@/components/person/channel-mark";
import type { Channel } from "@/lib/types";
import { linkRefOf, mattersOf, type Matter, type MatterLink } from "@/lib/timeline/matters";
import { refKey, TYPE_LABEL, type TimelineItem, type TimelineType } from "@/lib/timeline/types";

const ICON: Record<Exclude<TimelineType, "message">, LucideIcon> = { meeting: Video, note: StickyNote, promise: Handshake, task: CheckSquare, document: FileText, lead: UserPlus };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export interface RowMatters {
  matters: Matter[];
  links: MatterLink[];
  onToggle: (matter: Matter, item: TimelineItem, held: boolean) => void;
  onNew: (item: TimelineItem) => void;
}

export function TimelineRow({ item, matters }: { item: TimelineItem; matters: RowMatters }) {
  const ref = linkRefOf(item.refs);
  const holding = mattersOf(item.refs, matters.links, matters.matters);
  const heldIn = new Set(ref ? matters.links.filter((l) => refKey(l.kind, l.targetId) === refKey(ref.kind, ref.id)).map((l) => l.matterId) : []);
  const open = matters.matters.filter((m) => !m.closed || heldIn.has(m.id));
  return (
    <li className="group flex gap-3 py-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" title={TYPE_LABEL[item.type]}>
        {item.type === "message" ? <ChannelMark channel={(item.channel ?? "email") as Channel} /> : (() => { const Icon = ICON[item.type]; return <Icon aria-hidden className="size-3.5" />; })()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {item.href ? <Link href={item.href} className="min-w-0 truncate text-sm font-medium hover:underline">{item.title}</Link> : <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{time(item.at)}</span>
        </div>
        {item.detail && <p className="line-clamp-2 text-sm text-muted-foreground">{item.detail}</p>}
        {holding.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">{holding.map((m) => <Badge key={m.id} variant="secondary" className="max-w-40 truncate">{m.name}</Badge>)}</div>
        )}
      </div>
      {ref && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 shrink-0 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100" aria-label="Add to Matter"><Plus /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 w-max min-w-52 overflow-y-auto">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{ref.kind === "thread" ? "Add This Conversation To" : "Add To"}</DropdownMenuLabel>
            {open.map((m) => (
              <DropdownMenuCheckboxItem key={m.id} checked={heldIn.has(m.id)} onCheckedChange={() => matters.onToggle(m, item, heldIn.has(m.id))}>
                <span className="truncate">{m.name}</span>
              </DropdownMenuCheckboxItem>
            ))}
            {open.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => matters.onNew(item)}>New Matter</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
