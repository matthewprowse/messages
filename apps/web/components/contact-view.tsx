"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "sonner";
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
import { ConversationRows, DetailList, DetailPage, Section } from "@/components/contact-list";
import { withQuery } from "@/lib/utils";
import { formatPhone } from "@/lib/format";
import { EditContactDialog } from "@/components/contact-edit-dialog";
import { MeetingList } from "@/components/meeting-card";
import { useMeetings } from "@/components/meetings-data";

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

/** Their meetings on Teams, Zoom and Google Meet, newest first. Shown once there is one. */
function ContactMeetings({ contactId }: { contactId: string }) {
  const scope = useMemo(() => ({ contactIds: [contactId] }), [contactId]);
  const { meetings } = useMeetings(scope);
  if (meetings.length === 0) return null;
  return (
    <Section title="Meetings">
      <MeetingList meetings={meetings} place="contact" />
    </Section>
  );
}

export function ContactView({ contact }: { contact: ContactDetail | null }) {
  const backHref = withQuery("/contacts", useSearchParams().toString());
  const [editing, setEditing] = useState(false);
  // An address picked in Details opens New Email to it.
  const [email, setEmail] = useState({ open: false, to: "" });

  if (!contact) {
    return <EmptyState icon={Users} title="Contact Not Found" description="They may have been merged or deleted." action={<Button variant="outline" asChild><Link href="/contacts">Back to Contacts</Link></Button>} />;
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast(`Copied ${text}`),
      () => toast("Could not copy. Select it and copy it by hand."),
    );
  };

  const details: { label: string; value: string; href?: string; onSelect?: () => void }[] = [
    ...contact.emails.map((value) => ({ label: "Email", value, onSelect: () => setEmail({ open: true, to: value }) })),
    ...contact.phones.map((value) => ({ label: "Phone", value: formatPhone(value), onSelect: () => copy(formatPhone(value)) })),
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
            <h1 className="truncate text-base font-medium">{contact.name}</h1>
          </div>
          {/* On phones Edit moves into the More menu to leave room for the name. */}
          <Button variant="outline" className="max-sm:hidden" onClick={() => setEditing(true)}>Edit</Button>
          <MessageButton contact={contact} />
          <ContactMenu contact={contact} backHref={backHref} onEdit={() => setEditing(true)} />
          <EditContactDialog contact={contact} open={editing} onOpenChange={setEditing} />
          <ComposeDialog open={email.open} onOpenChange={(open) => setEmail((e) => ({ ...e, open }))} to={email.to ? [email.to] : []} />
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
          <ConversationRows items={contact.conversations} />
        )}
      </Section>

      <ContactMeetings contactId={contact.id} />

      {contact.attachments.length > 0 && (
        <Section title="Attachments">
          <AttachmentGrid items={contact.attachments} />
        </Section>
      )}
    </DetailPage>
  );
}
