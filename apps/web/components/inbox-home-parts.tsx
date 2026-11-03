"use client";

// The empty Conversations page's parts: a conversation as a link (avatar, name and the AI's summary or the latest message),
// and the card and number card, which are the shared ones in surface.tsx under the names this page has always used.

import Link from "next/link";
import { useApp } from "@/lib/store";
import { niceName, relTime } from "@/lib/format";
import type { Thread } from "@/lib/types";
import { ContactAvatar, GroupAvatar } from "@/components/primitives";
import { ProviderBadge } from "@/components/provider-logo";
export { Card as HomeCard, StatCard } from "@/components/surface";

/** One conversation, laid out like a list row, opening it in Conversations. */
export function ConversationLink({ thread }: { thread: Thread }) {
  const { contactById } = useApp();
  const contact = thread.isGroup ? undefined : contactById(thread.participantIds[0]);
  const title = niceName((thread.isGroup ? thread.groupName : contact?.name ?? thread.fallbackName) ?? "Unknown");
  const line = thread.summary.trim() || (thread.channel === "email" ? thread.subject : undefined) || thread.preview || "";
  return (
    <Link href={`/inbox/${thread.id}`} className="flex items-center gap-3 rounded-lg p-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset">
      <span className="relative shrink-0">
        {thread.isGroup ? <GroupAvatar path={thread.avatarPath} className="size-10" /> : <ContactAvatar contact={contact} className="size-10" />}
        <ProviderBadge provider={thread.provider} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex h-5 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium">{title}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(thread.lastMessageAt)}</span>
        </span>
        <span className="h-4 truncate text-xs">{line}</span>
      </span>
    </Link>
  );
}
