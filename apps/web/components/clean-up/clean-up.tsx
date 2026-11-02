"use client";

// Inbox, Clean Up: bulk senders whose email you have not opened for 90 days, with Unsubscribe All and Mark as Junk. The list
// is worked out from the conversations already loaded (lib/clean-up.ts), no AI. Nothing is sent or changed until you press
// a button: Unsubscribe All asks first, then goes down the same path as Subscriptions, which queues the request for the
// worker (some senders only get an address to confirm on their own page).

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MailX, OctagonAlert } from "lucide-react";
import { track } from "@/lib/analytics";
import { CLEAN_UP_DAYS, cleanUpLine, cleanUpSenders } from "@/lib/clean-up";
import { canPick } from "@/lib/subscription-senders";
import { useApp } from "@/lib/store";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { PaneHeader } from "@/components/pane";
import { CompanyAvatar, ContactAvatar, EmptyState } from "@/components/primitives";
import { Check } from "lucide-react";

export function CleanUp() {
  const { threads, loading, contactById, unsubscribes, unsubscribe, setJunk } = useApp();
  const [asking, setAsking] = useState(false);
  const [junked, setJunked] = useState<Set<string>>(new Set());
  const senders = useMemo(() => cleanUpSenders(threads, contactById), [threads, contactById]);
  const status = useMemo(() => new Map(unsubscribes.map((u) => [`${u.accountId}:${u.sender}`, u])), [unsubscribes]);
  // Addresses that can still be unsubscribed from, by sender.
  const open = (s: (typeof senders)[number]) => (s.canUnsubscribe ? s.addresses.filter((a) => canPick(status.get(a.key))) : []);
  const shown = senders.filter((s) => !junked.has(s.key) || open(s).length > 0);
  const all = shown.flatMap(open);

  const unsubscribeFrom = async (addresses: { accountId: string; address: string }[]) => {
    if (addresses.length === 0) return;
    track("feature_used", { feature: "unsubscribe", detail: addresses.length > 1 ? "many" : "one" });
    await unsubscribe(addresses.map((a) => ({ accountId: a.accountId, sender: a.address })));
  };
  const markJunk = (s: (typeof senders)[number]) => {
    setJunk(s.threadIds.filter((id) => !threads.find((t) => t.id === id)?.junk), true);
    setJunked((j) => new Set(j).add(s.key));
    track("feature_used", { feature: "clean_up", detail: "junk" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader
        title={<span className="flex items-center gap-2"><Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back"><Link href="/inbox"><ArrowLeft /></Link></Button>Clean Up</span>}
        action={<Button variant="secondary" disabled={all.length === 0} onClick={() => setAsking(true)}><MailX />Unsubscribe All</Button>}
      >
        <p className="text-sm text-muted-foreground">Senders you have not opened in {CLEAN_UP_DAYS} days. Nothing happens until you press a button.</p>
      </PaneHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {shown.length === 0 ? (
            <EmptyState icon={Check} title="Nothing to Clean Up" description={loading ? undefined : "Every sender you get bulk mail from has been opened lately."} loading={loading} />
          ) : shown.map((s, i) => {
            const pending = open(s);
            const state = s.addresses.map((a) => status.get(a.key)).find((u) => u && !canPick(u));
            return (
              <div key={s.key}>
                {i > 0 && <div className="pb-2 pl-14"><Separator /></div>}
                <div className="flex items-center gap-3 rounded-lg p-3">
                  {s.company ? <CompanyAvatar logoPath={s.company.logoPath} className="size-8" /> : <ContactAvatar contact={s.contact} className="size-8" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{cleanUpLine(s)}{state ? `. ${state.status === "done" ? "Unsubscribed" : "Unsubscribing"}` : ""}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {pending.length > 0 && <Button size="sm" variant="secondary" onClick={() => void unsubscribeFrom(pending)}><MailX />Unsubscribe</Button>}
                    {!s.allJunk && !junked.has(s.key) && <Button size="sm" variant="ghost" onClick={() => markJunk(s)}><OctagonAlert />Mark as Junk</Button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsubscribe From {shown.filter((s) => open(s).length > 0).length} Senders?</AlertDialogTitle>
            <AlertDialogDescription>Konva asks each sender to take you off its list. Some may send a short confirmation for you to finish on their own page. You can follow each one under Subscriptions.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void unsubscribeFrom(all)}>Unsubscribe All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
