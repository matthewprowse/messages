"use client";

// The Inbox's Deleted view: conversations in the bin, each with Restore. They are read when the view opens, as the store
// does not hold them. There is no Delete Forever: the mail actions the worker carries out have no permanent delete, and
// non-email chats have nothing at a provider to remove, so only Restore is offered (see docs/PLAN.md).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { loadDeletedThreads } from "@/lib/data/load-deleted";
import { niceName, relTime } from "@/lib/format";
import { matchesSearch } from "@/lib/thread-list";
import type { Thread } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EmptyState, ThreadAvatar } from "@/components/primitives";
import { LoadingRows } from "./loading-rows";

export function DeletedList({ term }: { term: string }) {
  const { contactById, restore } = useApp();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    loadDeletedThreads().then(setThreads, () => setFailed(true));
  }, []);
  // Read again whenever the view opens, so a conversation deleted a moment ago is in the list.
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(
    () => (threads ?? []).filter((t) => !term || matchesSearch(t, term, (x) => contactById(x.participantIds[0])?.name)),
    [threads, term, contactById],
  );
  const bring = async (t: Thread) => {
    if (await restore([t])) setThreads((all) => (all ?? []).filter((x) => x.id !== t.id));
  };

  if (failed) {
    return <EmptyState icon={Trash2} title="Could Not Load Deleted" description="Check your connection and try again." action={<Button onClick={load}>Try Again</Button>} />;
  }
  if (threads === null) return <LoadingRows />;
  if (shown.length === 0) {
    return term
      ? <EmptyState icon={Trash2} title="No Matches" description="No deleted conversations match your search." />
      : <EmptyState icon={Trash2} title="Nothing Deleted" description="Conversations you delete can be restored from here." />;
  }
  return (
    <div className="flex flex-col gap-2">
      {shown.map((t, i) => {
        const contact = t.isGroup ? undefined : contactById(t.participantIds[0]);
        const title = niceName((t.isGroup ? t.groupName : contact?.name ?? t.fallbackName) ?? t.subject ?? "Unknown");
        return (
          <div key={t.id}>
            {i > 0 && <div className="mb-2 pl-16"><Separator /></div>}
            <div className="flex items-center gap-3 rounded-lg p-3 hover:bg-muted/50">
              <ThreadAvatar thread={t} contacts={contactById} className="size-10 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex h-5 items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">{title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relTime(t.lastMessageAt)}</span>
                </div>
                <span className="min-w-0 truncate text-xs">{(t.channel === "email" ? t.subject : undefined) ?? t.preview ?? ""}</span>
              </div>
              <Button variant="secondary" onClick={() => bring(t)}><ArchiveRestore />Restore</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
