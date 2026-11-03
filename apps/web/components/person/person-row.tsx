// One row of the By Person list: the person's photo, name, the icons of the channels they are on, and the newest message across
// all of them. A group (no single person) is a row too and opens its own conversation. Opening a row marks nothing read.

import { memo } from "react";
import Link from "next/link";
import { Pin } from "lucide-react";
import type { Contact } from "@/lib/types";
import { niceName, relTime } from "@/lib/format";
import { personHref, type PersonGroup } from "@/lib/person-groups";
import { cn } from "@/lib/utils";
import { ContactAvatar, GroupAvatar } from "@/components/primitives";
import { ChannelMarks } from "@/components/person/channel-mark";

export const PersonRow = memo(function PersonRow({ group, contact, query, selected, onPress }: {
  group: PersonGroup;
  /** The person, when the row is one. */
  contact?: Contact;
  query: string;
  selected: boolean;
  /** Pointer down: starts loading the newest conversation, as a conversation row does. */
  onPress: (threadId: string) => void;
}) {
  const t = group.newest;
  const title = niceName((t.isGroup ? t.groupName : contact?.name ?? t.fallbackName) ?? "Unknown");
  // Email shows its subject, chats their latest message, as in the ordinary list.
  const body = (t.channel === "email" ? t.subject : undefined) ?? t.preview ?? "";
  return (
    <Link
      href={personHref(group, query)}
      data-row-link
      aria-current={selected ? "page" : undefined}
      onPointerDown={() => onPress(t.id)}
      className={cn("flex items-center gap-3 rounded-lg p-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset", selected && "bg-muted")}
    >
      {t.isGroup ? <GroupAvatar path={t.avatarPath} className="size-10 shrink-0" /> : <ContactAvatar contact={contact} className="size-10 shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-5 items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium">{title}</span>
            <ChannelMarks channels={group.channels} />
            {group.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(t.lastMessageAt)}</span>
        </div>
        <div className="flex h-4 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-xs text-foreground">{body}</span>
          {group.unread > 0 && (
            <span className="-my-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium" aria-label={`${group.unread} unread`}>{group.unread}</span>
          )}
        </div>
      </div>
    </Link>
  );
});
