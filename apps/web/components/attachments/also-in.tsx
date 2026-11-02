"use client";

// "Also in N Conversations" in the viewer: identical files are stored once, so a file that reached you in several chats is
// the same copy. Lists those other conversations with links. Shows nothing when there are none.

import Link from "next/link";
import { alsoInLabel, copyHref } from "@/lib/attachment-actions/copies";
import { useOtherConversations } from "@/lib/attachment-actions/load-copies";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function AlsoIn({ attachmentId, threadId, open }: { attachmentId: string; threadId?: string; open: boolean }) {
  const { threadById, contactById } = useApp();
  const others = useOtherConversations(attachmentId, threadId, open);
  if (others.length === 0) return null;
  const title = (id: string) => {
    const t = threadById(id);
    const person = t?.participantIds.map((p) => contactById(p)?.name).find(Boolean);
    return t?.subject?.trim() || t?.groupName || person || t?.fallbackName || "Conversation";
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="link" className="h-auto justify-start px-0 text-xs">{alsoInLabel(others.length)}</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-1 p-2">
        {others.slice(0, 20).map((c) => (
          <Link key={c.threadId} href={copyHref(c)} className="truncate rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:bg-muted">{title(c.threadId)}</Link>
        ))}
        {others.length > 20 && <p className="px-2 py-1 text-xs text-muted-foreground">And {others.length - 20} more.</p>}
      </PopoverContent>
    </Popover>
  );
}
