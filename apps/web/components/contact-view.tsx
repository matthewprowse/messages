"use client";

// A contact's page under Contacts, laid out like an open conversation: the header (star, message, notes, follow up and
// More), then on the grey the numbers (conversations, when they and you last wrote) and the Timeline or the Overview.
// A partial contact (drawn from what the app held, before the read lands) shows the header and numbers and holds back
// what needs the full read: the Timeline and Overview, Edit and the More menu (Split needs the address ids).

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Star, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { ContactDetail } from "@/lib/contacts";
import { setContactVip } from "@/lib/contact-relations-io";
import { niceName } from "@/lib/format";
import { daysSince } from "@/lib/relationship-status";
import { withQuery } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { NotesChip } from "@/components/notes-chip";
import { ViewButtons } from "@/components/pane";
import { StatCard } from "@/components/surface";
import { IconAction } from "@/components/tip";
import { ContactMenu } from "@/components/contact-merge-actions";
import { BadgedAvatar, DetailHeading, DetailPage } from "@/components/contact-list";
import { EditContactDialog } from "@/components/contact-edit-dialog";
import { useContactsData } from "@/components/contacts-data";
import { ContactOverview } from "@/components/contacts/contact-overview";
import { FollowUpMenu } from "@/components/contacts/follow-up-menu";
import { MessageMenu } from "@/components/contacts/message-menu";
import { TimelineTab } from "@/components/timeline/timeline-tab";

type Tab = "timeline" | "overview";

/** How long ago, short enough for a number card three to a row on a phone: "Today", "12d", "2y", or "Never". */
function since(iso: string | null | undefined) {
  if (!iso) return "Never";
  const days = daysSince(iso, new Date());
  return days <= 0 ? "Today" : days < 365 ? `${days}d` : `${Math.floor(days / 365)}y`;
}
const TABS: { key: Tab; label: string }[] = [{ key: "timeline", label: "Timeline" }, { key: "overview", label: "Overview" }];

export function ContactView({ contact }: { contact: ContactDetail | null }) {
  const backHref = withQuery("/contacts", useSearchParams().toString());
  const [editing, setEditing] = useState(false);
  const { patchContact } = useContactsData();
  // The star shows at once and is put back if it cannot be saved.
  const [starred, setStarred] = useState<{ id: string; vip: boolean } | null>(null);
  // Contacts with any conversation open on their timeline; a contact made by hand opens on the overview.
  const [tab, setTab] = useState<Tab>(contact && contact.conversationCount > 0 ? "timeline" : "overview");

  if (!contact) {
    return <EmptyState icon={Users} title="Contact Not Found" action={<Button variant="secondary" asChild><Link href="/contacts">Back to Contacts</Link></Button>} />;
  }

  const vip = starred?.id === contact.id ? starred.vip : !!contact.vip;
  const toggleStar = async () => {
    const next = !vip;
    setStarred({ id: contact.id, vip: next });
    patchContact(contact.id, { vip: next });
    if (!(await setContactVip(contact.id, next))) {
      setStarred({ id: contact.id, vip: !next });
      patchContact(contact.id, { vip: !next });
      toast("Could not save the star. Check your connection and try again.");
    }
  };
  // Under the name, as on a company's page: their role and where they work.
  const work = [contact.role, contact.organization?.name ?? contact.company].filter(Boolean).join(", ");
  // Their main channel: the newest one-to-one conversation's service.
  const provider = contact.conversations.find((c) => !c.isGroup)?.provider;
  const partial = !!contact.partial;
  // The store's contact has no last message each way; the list's row does. Unknown shows as loading, not "Never".
  const lastSeen = (iso: string | null | undefined) => (partial && iso === undefined ? undefined : since(iso));

  return (
    <DetailPage
      backHref={backHref}
      header={
        <>
          <DetailHeading avatar={<BadgedAvatar avatar={<ContactAvatar contact={contact} className="size-10" />} provider={provider} />} title={niceName(contact.name)} subtitle={work} />
          <div className="flex shrink-0 items-center gap-1">
            <IconAction label={vip ? "Remove Star" : "Star"} icon={Star} active={vip} className={vip ? "[&_svg]:fill-current" : undefined} onClick={() => void toggleStar()} />
            <MessageMenu contact={contact} />
            <NotesChip kind="contact" id={contact.id} />
            <FollowUpMenu contactId={contact.id} name={contact.name} />
            {!partial && <ContactMenu contact={contact} backHref={backHref} onEdit={() => setEditing(true)} />}
          </div>
          {!partial && <EditContactDialog contact={contact} open={editing} onOpenChange={setEditing} />}
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Conversations" value={contact.conversationCount} />
        <StatCard label="Last From Them" value={lastSeen(contact.lastInboundAt)} />
        <StatCard label="Last From You" value={lastSeen(contact.lastOutboundAt)} />
      </div>
      <div className="flex h-10 items-center">
        <ViewButtons label="Show" value={tab} onSelect={setTab} items={TABS} />
      </div>
      {partial ? <Skeleton className="h-64 w-full rounded-lg" /> : tab === "timeline" ? <TimelineTab key={contact.id} contact={contact} /> : <ContactOverview contact={contact} />}
    </DetailPage>
  );
}
