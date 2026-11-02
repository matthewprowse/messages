"use client";

// What's New: every published update, newest first, read only. Open to any signed-in person; the database hands back
// published rows only, so drafts never show here even to the owner's own account on this page.

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { loadPublishedUpdates } from "@/lib/updates-reader";
import type { ReaderUpdate } from "@/lib/updates-seen";
import { PaneHeader } from "@/components/pane";
import { EmptyState } from "@/components/primitives";
import { WhatsNewEntry } from "@/components/whats-new/whats-new-entry";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export default function WhatsNewPage() {
  const [updates, setUpdates] = useState<ReaderUpdate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => { setFailed(false); loadPublishedUpdates().then(setUpdates).catch(() => setFailed(true)); };
  useEffect(load, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0"><PaneHeader title="What's New" /></div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl p-3 md:px-4">
          {updates === null && !failed && <div className="flex flex-col gap-3"><Skeleton className="h-32 w-full rounded-lg" /><Skeleton className="h-32 w-full rounded-lg" /></div>}
          {failed && <EmptyState icon={Megaphone} title="Could Not Load Updates" description="Check your connection and try again." action={<Button variant="secondary" onClick={load}>Retry</Button>} />}
          {updates?.length === 0 && <div className="py-24"><EmptyState icon={Megaphone} title="Nothing Yet" description="When Konva gets something new, it will be listed here." /></div>}
          {updates?.map((u, i) => (
            <div key={u.id}>
              {i > 0 && <Separator className="my-3" />}
              <div className="p-3"><WhatsNewEntry update={u} /></div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
