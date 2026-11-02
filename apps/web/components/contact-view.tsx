"use client";

// A contact's page under Contacts: where you stand with them, their summary and About note, details, conversations and
// meetings, and the buttons to message, star and follow up with them.

import { NotesChip } from "@/components/notes-chip";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Star, Users } from "lucide-react";
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
import { formatPhone, niceName } from "@/lib/format";
import { EditContactDialog } from "@/components/contact-edit-dialog";
import { MeetingList } from "@/components/meeting-card";
import { ClientCard } from "@/components/prep/client-card";
import { FollowUpMenu } from "@/components/contacts/follow-up-menu";
import { useContactsData } from "@/components/contacts-data";
import { setContactVip } from "@/lib/contact-relations-io";
import { statusLine } from "@/lib/relationship-status";
import { useMeetings } from "@/components/meetings-data";

// Email goes through New Email, a first WhatsApp message through New WhatsApp Message, and an event
// with them as a guest through New Event. An existing WhatsApp chat opens instead of starting another.
function MessageButton({ contact }: { contact: ContactDetail }) {
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
  const { patchContact } = useContactsData();
  // The star shows at once and is put back if it cannot be saved.
  const [starred, setStarred] = useState<{ id: string; vip: boolean } | null>(null);
  // An address picked in Details opens New Email to it.
  const [email, setEmail] = useState({ open: false, to: "" });

  if (!contact) {
    return <EmptyState icon={Users} title="Contact Not Found" description="They may have been merged or deleted." action={<Button variant="secondary" asChild><Link href="/contacts">Back to Contacts</Link></Button>} />;
  }

  const vip = contact && starred?.id === contact.id ? starred.vip : !!contact?.vip;
  const toggleStar = async () => {
    if (!contact) return;
    const next = !vip;
    setStarred({ id: contact.id, vip: next });
    patchContact(contact.id, { vip: next });
    if (!(await setContactVip(contact.id, next))) {
      setStarred({ id: contact.id, vip: !next });
      patchContact(contact.id, { vip: !next });
      toast("Could not save the star. Check your connection and try again.");
    }
  };
  const status = statusLine(contact.lastInboundAt, contact.lastOutboundAt);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast(`Copied ${text}`),
      () => toast("Could not copy. Select it and copy it by hand."),
    );
  };

  // Under the name, as on a company's page: their role and where they work.
  const work = [contact.role, contact.organization?.name ?? contact.company].filter(Boolean).join(", ");

  const details: { label: string; value: string; href?: string; onSelect?: () => void }[] = [
    ...contact.emails.map((value) => ({ label: "Email", value, onSelect: () => setEmail({ open: true, to: value }) })),
    ...contact.phones.map((value) => ({ label: "Phone", value: formatPhone(value), onSelect: () => copy(formatPhone(value)) })),
    ...contact.handles.map((handle) => ({ label: "Instagram", value: `@${handle}`, onSelect: () => copy(`@${handle}`) })),
    // LinkedIn gives an id, not a name or a link, so only the fact is shown.
    ...(contact.hasLinkedIn ? [{ label: "LinkedIn", value: "Connected" }] : []),
    // The company filed for their email domain, and the one set in Edit when it is another: both are shown, so what
    // Edit saves is always on the page.
    ...(contact.organization ? [{ label: "Company", value: contact.organization.name, href: `/contacts/companies/${contact.organization.id}` }] : []),
    ...(contact.company && contact.company !== contact.organization?.name ? [{ label: contact.organization ? "Company You Set" : "Company", value: contact.company }] : []),
    ...(contact.role ? [{ label: "Role", value: contact.role }] : []),
    ...(contact.relationship ? [{ label: "Relationship", value: contact.relationship }] : []),
    ...(contact.leadSource ? [{ label: "Lead Source", value: contact.leadSource }] : []),
  ];

  return (
    // Same structure as a conversation: the header sticks to the scroll area and content scrolls underneath it.
    <DetailPage
      backHref={backHref}
      header={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ContactAvatar contact={contact} className="size-8" />
            <div className="flex min-w-0 flex-col">
              <h1 className="truncate text-sm font-medium">{niceName(contact.name)}</h1>
              {work && <span className="truncate text-xs text-muted-foreground">{work}</span>}
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label={vip ? "Remove Star" : "Star Contact"} aria-pressed={vip} title={vip ? "Starred: always priority" : "Star to keep them at the top and always priority"} onClick={() => void toggleStar()}>
            <Star className={vip ? "fill-current" : undefined} />
          </Button>
          {/* On phones Edit moves into the More menu to leave room for the name. */}
          <Button variant="secondary" className="max-sm:hidden" onClick={() => setEditing(true)}>Edit</Button>
          <MessageButton contact={contact} />
          <ContactMenu contact={contact} backHref={backHref} onEdit={() => setEditing(true)} />
          <EditContactDialog contact={contact} open={editing} onOpenChange={setEditing} />
          <ComposeDialog open={email.open} onOpenChange={(open) => setEmail((e) => ({ ...e, open }))} to={email.to ? [email.to] : []} />
        </>
      }
    >
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm">{status ?? "No one-to-one conversation yet."}</p>
        <div className="flex items-center gap-2">
          <NotesChip kind="contact" id={contact.id} />
          <FollowUpMenu contactId={contact.id} name={contact.name} />
        </div>
      </div>

      {contact.summary && (
        <Section title="Summary">
          <p className="text-sm leading-6 text-muted-foreground">{contact.summary}</p>
        </Section>
      )}

      {contact.aboutNote && (
        <Section title="About">
          <p className="text-sm leading-6 whitespace-pre-line text-muted-foreground">{contact.aboutNote}</p>
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
          <ConversationRows items={contact.conversations} avatar={<ContactAvatar contact={contact} className="size-8" />} />
        )}
      </Section>

      <ClientCard contactId={contact.id} />

      <ContactMeetings contactId={contact.id} />

      {contact.attachments.length > 0 && (
        <Section title="Attachments">
          <AttachmentGrid items={contact.attachments} />
        </Section>
      )}
    </DetailPage>
  );
}
