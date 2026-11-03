"use client";

// The What's New dialog, opened once after sign-in when the newest published update is newer than the one this person last
// saw. It shows what changed, grouped New, Improved and Fixed, rather than pointing at the app. Mounted once in the app shell.
// It stays out of the way until setup has finished, and closing it (either button) is what marks the update as seen.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useOnboardingMeta } from "@/lib/onboarding";
import { loadPublishedUpdates, markWhatsNewSeen } from "@/lib/updates-reader";
import { latestUpdate, seenFromMetadata, shouldShowWhatsNew, type ReaderUpdate } from "@/lib/updates-seen";
import { WhatsNewEntry } from "@/components/whats-new/whats-new-entry";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Loads the published updates once per sign-in and opens the dialog when there is something new to show. Renders nothing otherwise. */
export function WhatsNewDialog() {
  const { session } = useAuth();
  const { onboarding } = useOnboardingMeta();
  const userId = session?.user.id;
  const [latest, setLatest] = useState<ReaderUpdate | undefined>();
  const [open, setOpen] = useState(false);
  // Decided once per page load: marking it seen changes the session metadata, which must not reopen or flicker the dialog.
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    loadPublishedUpdates().then((list) => { if (live) setLatest(latestUpdate(list)); }).catch(() => {});
    return () => { live = false; };
  }, [userId]);

  useEffect(() => {
    if (decided || !latest || !session) return;
    const show = shouldShowWhatsNew({ latest, seen: seenFromMetadata(session.user.user_metadata), joinedAt: session.user.created_at, onboarding });
    // While setup runs we wait; once it finishes onboarding changes and this effect runs again.
    if (onboarding !== undefined && onboarding !== "done") return;
    setDecided(true);
    setOpen(show);
  }, [decided, latest, session, onboarding]);

  const close = () => {
    setOpen(false);
    if (latest) void markWhatsNewSeen(latest).catch(() => {});
  };

  if (!latest) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What's New</DialogTitle>
          <DialogDescription>{latest.title}{latest.version ? ` (${latest.version})` : ""}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh]">
          <div className="pr-3"><WhatsNewEntry update={latest} compact /></div>
        </ScrollArea>
        <div className={DIALOG_BUTTONS}>
          <Button variant="ghost" asChild><Link href="/settings/whats-new" onClick={close}>See All Updates</Link></Button>
          <Button onClick={close}>Got It</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
