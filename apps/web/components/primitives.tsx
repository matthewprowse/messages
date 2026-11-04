"use client";

// Every avatar in the app is a 32px circle showing the photo (from your address book or WhatsApp) or logo
// once there is one, and an icon for the kind it is until then: a person, a company or a group.

import { useEffect } from "react";
import { wordOf } from "@messages/analytics";
import { track } from "@/lib/analytics";
import { Building2, User, Users, type LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { useAvatarUrl, useLogoUrl } from "@/lib/avatars";
import type { Contact, Provider, Thread } from "@/lib/types";

function PhotoAvatar({ path, icon: Icon, className }: { path?: string; icon: LucideIcon; className?: string }) {
  const url = useAvatarUrl(path);
  return (
    <Avatar className={cn("size-8", className)}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback><Icon className="size-1/2" /></AvatarFallback>
    </Avatar>
  );
}

/** A person's photo, or a company's logo for a sender that writes as the company. Until there is one, a person icon or a building. */
export function ContactAvatar({ contact, className }: { contact?: Pick<Contact, "avatarPath" | "isCompany">; size?: "xs" | "sm" | "md" | "lg" | "xl"; className?: string }) {
  return <PhotoAvatar path={contact?.avatarPath} icon={contact?.isCompany ? Building2 : User} className={className} />;
}

/**
 * A company's picture: its shared logo (lib/logo-paths.ts), or a building icon while it has none.
 */
export function CompanyAvatar({ logoPath, className }: { logoPath?: string | null; className?: string }) {
  const url = useLogoUrl(logoPath ?? undefined);
  return (
    <Avatar className={cn("size-8", className)}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback><Building2 className="size-1/2" /></AvatarFallback>
    </Avatar>
  );
}

/** A group's picture, or a people icon while it has none. */
export function GroupAvatar({ path, className }: { path?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return <PhotoAvatar path={path} icon={Users} className={className} />;
}

/** A group's picture, or the other person's photo in a one-to-one conversation. */
export function ThreadAvatar({ thread, contacts, className }: { thread: Thread; contacts: (id: string) => Contact | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  if (thread.isGroup) return <GroupAvatar path={thread.avatarPath} className={className} />;
  return <ContactAvatar contact={contacts(thread.participantIds[0])} className={className} />;
}

export const providerLabel: Record<Provider, string> = {
  icloud: "iCloud Mail",
  gmail: "Gmail",
  outlook: "Outlook",
  whatsapp: "WhatsApp",
  google_calendar: "Google Calendar",
  outlook_calendar: "Outlook Calendar",
  icloud_calendar: "iCloud Calendar",
  imap: "Email",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  google_meet: "Google Meet",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  microsoft_todo: "Microsoft To Do",
  google_tasks: "Google Tasks",
  icloud_reminders: "iCloud Reminders",
};

export function EmptyState({ icon: Icon, title, description, action, loading = false }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode; loading?: boolean }) {
  // Which empty or failed state was reached, by its fixed title. "Pick a ..." and "Select a ..." only invite a choice, so they are not one.
  useEffect(() => {
    const what = wordOf(title);
    if (what && !what.startsWith("pick_a_") && !what.startsWith("select_a_")) track("empty_state", { what });
  }, [title]);
  return (
    <Empty role={loading ? "status" : undefined} aria-busy={loading || undefined} className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
