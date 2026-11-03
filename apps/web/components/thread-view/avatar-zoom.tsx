"use client";

// The avatar in a conversation's header. With a photo, a click opens it large; without one it is just the avatar,
// since a person or group icon has nothing more to show.

import { useState } from "react";
import type { Contact, Thread } from "@/lib/types";
import { useAvatarUrl } from "@/lib/avatars";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ThreadAvatar } from "@/components/primitives";
import { ProviderBadge } from "@/components/provider-logo";

export function AvatarZoom({ thread, contacts, title }: { thread: Thread; contacts: (id: string) => Contact | undefined; title: string }) {
  const [open, setOpen] = useState(false);
  const path = thread.isGroup ? thread.avatarPath : contacts(thread.participantIds[0])?.avatarPath;
  const url = useAvatarUrl(path ?? undefined);
  const avatar = (
    <span className="relative block shrink-0">
      <ThreadAvatar thread={thread} contacts={contacts} className="size-10" />
      <ProviderBadge provider={thread.provider} />
    </span>
  );
  if (!url) return avatar;
  return (
    <>
      <button type="button" aria-label={`View ${title}'s Photo`} className="shrink-0 cursor-zoom-in rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => setOpen(true)}>
        {avatar}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* The stock X, which a photo viewer reads better with than a button row. */}
        <DialogContent className="sm:max-w-xs">
          <DialogTitle>{title}</DialogTitle>
          <img src={url} alt={title} className="aspect-square w-full rounded-lg object-cover" />
        </DialogContent>
      </Dialog>
    </>
  );
}
