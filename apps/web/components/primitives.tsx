"use client";

import { useEffect } from "react";
import Link from "next/link";
import { wordOf } from "@messages/analytics";
import { track } from "@/lib/analytics";
import { Paperclip, type LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { useAvatarUrl } from "@/lib/avatars";
import type { Category, Contact, Priority, Provider, Thread } from "@/lib/types";

// Every avatar in the app is a plain 32px circle with no initials or icon, showing the person's photo
// (from your address book or WhatsApp) once there is one.
function PhotoAvatar({ path, className }: { path?: string; className?: string }) {
  const url = useAvatarUrl(path);
  return (
    <Avatar className={cn("size-8 after:hidden", className)}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback />
    </Avatar>
  );
}

export function ContactAvatar({ contact, className }: { contact?: Pick<Contact, "avatarPath">; size?: "xs" | "sm" | "md" | "lg" | "xl"; className?: string }) {
  return <PhotoAvatar path={contact?.avatarPath} className={className} />;
}

export function GroupAvatar({ className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return <PhotoAvatar className={className} />;
}

/** A group's picture, or the other person's photo in a one-to-one conversation. */
export function ThreadAvatar({ thread, contacts, className }: { thread: Thread; contacts: (id: string) => Contact | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  const path = thread.isGroup ? thread.avatarPath : contacts(thread.participantIds[0])?.avatarPath;
  return <PhotoAvatar path={path} className={className} />;
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

export const priorityLabel: Record<Priority, string> = { urgent: "Urgent", important: "Important", normal: "Normal", low: "Low" };

export function PriorityBadge({ priority, showAll = false, className }: { priority: Priority; showAll?: boolean; className?: string }) {
  if (!showAll && (priority === "normal" || priority === "low")) return null;
  return <Badge variant="secondary" className={cn("h-6 rounded-md", className)}>{priorityLabel[priority]}</Badge>;
}

export const categoryLabel: Record<Category, string> = {
  personal: "Personal",
  work: "Work",
  needs_reply: "Needs Reply",
  fyi: "FYI",
  newsletter: "Newsletter",
  notification: "Notification",
};

export function CategoryBadge({ category, className }: { category: Category; className?: string }) {
  return <Badge variant="secondary" className={className}>{categoryLabel[category]}</Badge>;
}

export function AttachmentIcon({ className }: { className?: string }) {
  return <Paperclip className={cn("size-3.5 text-muted-foreground", className)} />;
}

export function PageHeader({ title, subtitle, actions, className }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-end justify-between gap-4 px-4 pt-6 pb-4 md:px-8", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Wraps skeleton placeholders so screen readers hear that content is loading rather than a row of empty boxes. */
export function LoadingRegion({ label = "Loading", className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

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

export function ContactLink({ contact, className, children }: { contact: Contact; className?: string; children?: React.ReactNode }) {
  return (
    <Link href={`/contacts/${contact.id}`} className={cn("hover:underline underline-offset-2", className)}>
      {children ?? contact.name}
    </Link>
  );
}
