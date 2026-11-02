"use client";

// Edited and deleted WhatsApp messages. "Edited" under a bubble, and "Deleted by Sender" in place of its text, both open View Original:
// what the message said before. The worker keeps every earlier text sealed (message_versions); it is fetched and opened only when
// someone asks, and shown in a plain dialog with one Close button.

import { useEffect, useState } from "react";
import type { Message } from "@/lib/types";
import { loadVersions } from "@/lib/data/load-versions";
import { originalOf, type MessageVersion } from "@/lib/message-versions";
import { fullStamp } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; versions: MessageVersion[] };

function OriginalDialog({ m, open, onOpenChange }: { m: Message; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    if (!open) return;
    let stale = false;
    setLoaded({ state: "loading" });
    loadVersions(m.id).then(
      (versions) => !stale && setLoaded({ state: "ready", versions }),
      () => !stale && setLoaded({ state: "failed" }),
    );
    return () => { stale = true; };
  }, [open, m.id]);
  const original = loaded.state === "ready" ? originalOf(loaded.versions) : null;
  const later = loaded.state === "ready" ? loaded.versions.filter((v) => v !== original) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} track="view_original_whatsapp" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Original Message</DialogTitle>
          <DialogDescription>{m.deleted ? "The sender deleted this message. This is what it said." : "The sender edited this message. This is what it said first."}</DialogDescription>
        </DialogHeader>
        {loaded.state === "loading" && <Skeleton className="h-16 w-full" />}
        {loaded.state === "failed" && <p className="text-sm text-muted-foreground">The original could not be loaded. Try again.</p>}
        {loaded.state === "ready" && !original && <p className="text-sm text-muted-foreground">The original was not kept. It was changed before Konva began keeping them.</p>}
        {original && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="rounded-lg bg-muted p-3 leading-6"><p className="whitespace-pre-wrap break-words">{original.text}</p></div>
            {later.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">Earlier Edits</p>
                {later.map((v) => (
                  <div key={v.at} className="rounded-lg bg-muted p-3 leading-6">
                    <p className="whitespace-pre-wrap break-words">{v.text}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Changed {fullStamp(v.at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Edited" beside a message's time; clicking it opens the original. `dot` puts the separator in front when the time is shown. */
export function EditedMark({ m, dot }: { m: Message; dot: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {dot && <span aria-hidden>·</span>}
      <Button variant="ghost" size="xs" className="-mx-1 h-auto px-1 py-0 text-xs font-normal text-muted-foreground" onClick={() => setOpen(true)}>Edited</Button>
      <OriginalDialog m={m} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** What a deleted message shows in its bubble: that it was deleted, and a way to read what it said. */
export function DeletedNote({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="opacity-70">Deleted by Sender</p>
      <Button variant="ghost" size="xs" className="-ml-2 h-auto px-2 py-0.5 text-xs" onClick={() => setOpen(true)}>View Original</Button>
      <OriginalDialog m={m} open={open} onOpenChange={setOpen} />
    </div>
  );
}
