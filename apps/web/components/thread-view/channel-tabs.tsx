// The Email, WhatsApp, Instagram and LinkedIn tabs beside the More menu in a conversation header: other threads with this person, and New Email.

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useApp } from "@/lib/store";
import type { Contact, Thread } from "@/lib/types";
import { relTime } from "@/lib/format";
import { CHAT_TABS, theirThreads } from "@/lib/thread-channels";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// The new-email dialog is rarely opened, so its code loads on its own (as in new-menu.tsx).
const ComposeDialog = dynamic(() => import("@/components/compose-dialog").then((m) => m.ComposeDialog), { ssr: false });

/**
 * The places you talk to this person, beside the More menu. Email opens a menu of your email threads with
 * them, newest first with the open one ticked, and New Email to start a fresh one, since a new topic does
 * not belong in an old thread. Each chat tab (WhatsApp, Instagram, LinkedIn) opens your newest chat with them. Shown when there is somewhere to go.
 */
export function ChannelTabs({ thread, person, hrefFor }: { thread: Thread; person?: Contact; hrefFor: (threadId: string) => string }) {
  const { threads } = useApp();
  const [composing, setComposing] = useState(false);
  const { emails, chats } = useMemo(() => (person ? theirThreads(threads, person.id) : { emails: [] as Thread[], chats: new Map<Thread["channel"], Thread>() }), [threads, person]);
  const address = person?.emails[0];
  const canEmail = emails.length > 0 || !!address;
  const onEmail = thread.channel === "email";
  // In an email: another thread, a new email or their chat. In a chat: any way to email them.
  const somewhere = onEmail ? chats.size > 0 || !!address || emails.length > 1 : canEmail || chats.size > 1;
  if (!person || !somewhere) return null;
  return (
    <nav aria-label="Channels" className="flex shrink-0 items-center gap-1">
      {canEmail && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={onEmail ? "secondary" : "ghost"} className={cn("px-2", !onEmail && "text-muted-foreground")}>
              Email
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {emails.slice(0, 8).map((t) => (
              <DropdownMenuItem key={t.id} asChild className={t.id === thread.id ? "bg-secondary" : undefined}>
                <Link href={hrefFor(t.id)} aria-current={t.id === thread.id ? "page" : undefined}>
                  <span className="min-w-0 flex-1 truncate">{t.subject?.trim() || "No Subject"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relTime(t.lastMessageAt)}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            {emails.length > 0 && address && <DropdownMenuSeparator />}
            {address && <DropdownMenuItem onSelect={() => setComposing(true)}>New Email</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {CHAT_TABS.map(({ channel, label }) => {
        const chat = chats.get(channel);
        const on = thread.channel === channel;
        return chat && (
          <Button key={channel} asChild variant={on ? "secondary" : "ghost"} className={cn("px-2", !on && "text-muted-foreground")}>
            <Link href={hrefFor(chat.id)} aria-current={on ? "page" : undefined}>{label}</Link>
          </Button>
        );
      })}
      {address && <ComposeDialog open={composing} onOpenChange={setComposing} to={[address]} />}
    </nav>
  );
}
