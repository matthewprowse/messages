"use client";

// Message on a contact's page, as an icon with its menu. Email goes through New Email, a first WhatsApp message through
// New WhatsApp Message, and an event with them as a guest through New Event. An existing WhatsApp chat opens instead
// of starting another.

import { useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import type { ContactDetail } from "@/lib/contacts";
import { phonesOf } from "@/lib/new-items";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/tip";
import { ComposeDialog } from "@/components/compose-dialog";
import { NewEventDialog } from "@/components/new-event-dialog";
import { NewWhatsAppDialog, whatsappLinked } from "@/components/new-whatsapp-dialog";

export function MessageMenu({ contact }: { contact: ContactDetail }) {
  const { accounts } = useApp();
  const [open, setOpen] = useState<"email" | "whatsapp" | "event" | null>(null);
  const chat = contact.conversations.find((c) => c.channel === "whatsapp" && !c.isGroup);
  // The newest one-to-one chat on each of the other channels.
  const social = (["instagram", "linkedin"] as const).flatMap((channel) => {
    const c = contact.conversations.find((x) => (x.channel as string) === channel && !x.isGroup);
    return c ? [{ id: c.id, channel }] : [];
  });
  const phone = phonesOf(contact)[0];
  const linked = whatsappLinked(accounts);
  const set = (item: "email" | "whatsapp" | "event") => (value: boolean) => setOpen(value ? item : null);
  return (
    <>
      <DropdownMenu modal={false}>
        <Tip label="Message">
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Message"><MessageSquare /></Button></DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="w-max">
          <DropdownMenuItem onSelect={() => setOpen("email")}>New Email</DropdownMenuItem>
          {chat ? (
            <DropdownMenuItem asChild><Link href={`/inbox/${chat.id}`}>Open WhatsApp Chat</Link></DropdownMenuItem>
          ) : phone && linked ? (
            <DropdownMenuItem onSelect={() => setOpen("whatsapp")}>New WhatsApp Message</DropdownMenuItem>
          ) : phone ? (
            <DropdownMenuItem disabled className="flex-col items-start gap-0">
              <span>New WhatsApp Message</span>
              <span className="text-xs text-muted-foreground">Available once WhatsApp is linked</span>
            </DropdownMenuItem>
          ) : null}
          {/* Instagram and LinkedIn chats open where they are; starting one is done from the Inbox. */}
          {social.map((c) => (
            <DropdownMenuItem key={c.id} asChild><Link href={`/inbox/${c.id}`}>{c.channel === "instagram" ? "Open Instagram Chat" : "Open LinkedIn Chat"}</Link></DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setOpen("event")}>New Event</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ComposeDialog open={open === "email"} onOpenChange={set("email")} to={contact.emails.slice(0, 1)} />
      {phone && <NewWhatsAppDialog open={open === "whatsapp"} onOpenChange={set("whatsapp")} to={{ phone, name: contact.name }} />}
      <NewEventDialog open={open === "event"} onOpenChange={set("event")} guests={contact.emails.slice(0, 1)} />
    </>
  );
}
