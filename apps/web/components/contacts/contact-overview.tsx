"use client";

// A contact's Overview, as cards on the grey: Summary (with the client card), About, Details, Conversations, Meetings,
// Attachments and the automatic merges with Undo. Picking an address in Details opens New Email to it; a number or
// handle is copied.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { ContactDetail } from "@/lib/contacts";
import { formatPhone } from "@/lib/format";
import { AttachmentGrid } from "@/components/attachments";
import { ComposeDialog } from "@/components/compose-dialog";
import { MergedAutomatically } from "@/components/contact-merge-actions";
import { MeetingList } from "@/components/meeting-card";
import { useMeetings } from "@/components/meetings-data";
import { ContactAvatar } from "@/components/primitives";
import { SummaryCard } from "@/components/prep/client-card";
import { Card } from "@/components/surface";
import { ConversationRows, DetailList } from "./list-rows";

/** Their meetings on Teams, Zoom and Google Meet, newest first. Shown once there is one. */
function ContactMeetings({ contactId }: { contactId: string }) {
  const scope = useMemo(() => ({ contactIds: [contactId] }), [contactId]);
  const { meetings } = useMeetings(scope);
  if (meetings.length === 0) return null;
  return (
    <Card title="Meetings">
      <div className="px-2 pb-2"><MeetingList meetings={meetings} place="contact" /></div>
    </Card>
  );
}

const copy = (text: string) => {
  navigator.clipboard.writeText(text).then(
    () => toast(`Copied ${text}`),
    () => toast("Could not copy. Select it and copy it by hand."),
  );
};

export function ContactOverview({ contact }: { contact: ContactDetail }) {
  // An address picked in Details opens New Email to it.
  const [email, setEmail] = useState({ open: false, to: "" });
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
    <>
      <SummaryCard contactId={contact.id} summary={contact.summary} />
      {contact.aboutNote && (
        <Card title="About">
          <p className="px-3 pb-3 text-sm leading-6 whitespace-pre-line">{contact.aboutNote}</p>
        </Card>
      )}
      {details.length > 0 && (
        <Card title="Details">
          <DetailList items={details} />
        </Card>
      )}
      {contact.conversations.length > 0 && (
        <Card title="Conversations">
          <ConversationRows items={contact.conversations} avatar={<ContactAvatar contact={contact} className="size-10" />} />
        </Card>
      )}
      <ContactMeetings contactId={contact.id} />
      {contact.attachments.length > 0 && (
        <Card title="Attachments">
          <div className="px-3 pb-3"><AttachmentGrid items={contact.attachments} /></div>
        </Card>
      )}
      <MergedAutomatically contact={contact} />
      <ComposeDialog open={email.open} onOpenChange={(open) => setEmail((e) => ({ ...e, open }))} to={email.to ? [email.to] : []} />
    </>
  );
}
