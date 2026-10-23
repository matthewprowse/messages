"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import type { ContactDetail } from "@/lib/contacts";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { AttachmentGrid } from "@/components/attachments";
import { ComposeDialog } from "@/components/compose-dialog";
import { NewEventDialog } from "@/components/new-event-dialog";
import { NewWhatsAppDialog, whatsappLinked } from "@/components/new-whatsapp-dialog";
import { phonesOf } from "@/lib/new-items";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContactMenu, MergedAutomatically } from "@/components/contact-merge-actions";
import { DetailList, DetailPage, Divided, ListRow, Section, withQuery } from "@/components/contact-list";
import { formatPhone } from "@/lib/format";

// Email goes through New Email, a first WhatsApp message through New WhatsApp Message, and an event
// with them as a guest through New Event. An existing WhatsApp chat opens instead of starting another.
function MessageButton({ contact }: { contact: ContactDetail }) {
  const { accounts } = useApp();
  const [open, setOpen] = useState<"email" | "whatsapp" | "event" | null>(null);
  const chat = contact.conversations.find((c) => c.channel === "whatsapp" && !c.isGroup);
  const phone = phonesOf(contact)[0];
  const linked = whatsappLinked(accounts);
  const set = (item: "email" | "whatsapp" | "event") => (value: boolean) => setOpen(value ? item : null);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="secondary">Message</Button></DropdownMenuTrigger>
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
          <DropdownMenuItem onSelect={() => setOpen("event")}>New Event</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ComposeDialog open={open === "email"} onOpenChange={set("email")} to={contact.emails.slice(0, 1)} />
      {phone && <NewWhatsAppDialog open={open === "whatsapp"} onOpenChange={set("whatsapp")} to={{ phone, name: contact.name }} />}
      <NewEventDialog open={open === "event"} onOpenChange={set("event")} guests={contact.emails.slice(0, 1)} />
    </>
  );
}

export function ContactView({ contact }: { contact: ContactDetail | null }) {
  const backHref = withQuery("/contacts", useSearchParams().toString());

  if (!contact) {
    return <EmptyState icon={Users} title="Contact Not Found" description="They may have been merged or deleted." action={<Button variant="outline" asChild><Link href="/contacts">Back to Contacts</Link></Button>} />;
  }

  const details: { label: string; value: string; href?: string }[] = [
    ...contact.emails.map((value) => ({ label: "Email", value })),
    ...contact.phones.map((value) => ({ label: "Phone", value: formatPhone(value) })),
    ...(contact.organization
      ? [{ label: "Company", value: contact.organization.name, href: `/contacts/companies/${contact.organization.id}` }]
      : contact.company
        ? [{ label: "Company", value: contact.company }]
        : []),
    ...(contact.role ? [{ label: "Role", value: contact.role }] : []),
    ...(contact.relationship ? [{ label: "Relationship", value: contact.relationship }] : []),
  ];

  return (
    // Same structure as a conversation: the header sticks to the scroll area and content scrolls underneath it.
    <DetailPage
      backHref={backHref}
      header={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ContactAvatar contact={contact} className="size-10" />
            <span className="truncate text-sm font-medium">{contact.name}</span>
          </div>
          <MessageButton contact={contact} />
          <ContactMenu contact={contact} backHref={backHref} />
        </>
      }
    >
      {contact.summary && (
        <Section title="Summary">
          <p className="text-sm leading-6 text-muted-foreground">{contact.summary}</p>
        </Section>
      )}

      {details.length > 0 && (
        <Section title="Details">
          <DetailList items={details} />
        </Section>
      )}

      <MergedAutomatically contact={contact} />

      <Section title="Conversations">
        {contact.conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conversations yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Divided>
              {contact.conversations.map((t) => (
                <ListRow key={t.id} href={`/inbox/${t.id}`} title={t.title} at={t.lastAt} detail={t.preview ?? undefined} className="-mx-3 px-3 py-2" />
              ))}
            </Divided>
          </div>
        )}
      </Section>

      {contact.attachments.length > 0 && (
        <Section title="Attachments">
          <AttachmentGrid items={contact.attachments} />
        </Section>
      )}
    </DetailPage>
  );
}
