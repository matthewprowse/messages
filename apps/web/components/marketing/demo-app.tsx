"use client";

// The product pictures on the marketing site: the app's own ThreadRow, Bubble, SummaryStrip and DraftBar, filled with
// one trade's made up conversations from demo-data.ts. Rendered after mount (times are in the visitor's time zone,
// which the server does not know) and inert, so nothing in them can be clicked, focused or opened. The hero's inbox
// plays a short story (use-live-demo.ts).

import { useState, useSyncExternalStore } from "react";
import { Calendar, Inbox, Newspaper, NotebookPen, Paperclip, Search, Settings, Users } from "lucide-react";
import type { Message, Thread } from "@/lib/types";
import { ThreadRow } from "@/components/thread-list/thread-row";
import { Bubble, type BubbleHandlers } from "@/components/thread-view/bubble";
import { SummaryStrip } from "@/components/thread-view/summary-strip";
import { DraftBar } from "@/components/thread-view/draft-bar";
import { ContactAvatar, providerLabel } from "@/components/primitives";
import { ProviderBadge } from "@/components/provider-logo";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DEMO_SETS, type DemoKey, type DemoSet } from "./demo-data";
import { useLiveDemo } from "./use-live-demo";

const noop = () => {};
const subscribe = () => noop;

/** False on the server and in the first client render, true after: the demo waits for the visitor's clock. */
function useMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

/** A window around a product picture, the height it will be once filled, so the page does not jump when it mounts. */
export function DemoFrame({ className, children, label }: { className?: string; children: React.ReactNode; label: string }) {
  const mounted = useMounted();
  return (
    <div role="img" aria-label={label} className={cn("overflow-hidden rounded-xl border bg-background shadow-sm", className)}>
      <div inert className="h-full select-none">{mounted ? children : null}</div>
    </div>
  );
}

function DemoRows({ set, threads, fresh = [], summaries = false, selected }: { set: DemoSet; threads: Thread[]; fresh?: string[]; summaries?: boolean; selected?: string }) {
  return (
    <div className="flex flex-col gap-1 p-2">
      {threads.map((t) => (
        <div key={t.id} className={cn(fresh.includes(t.id) && "animate-in fade-in-0 slide-in-from-top-4 duration-700")}>
          <ThreadRow
            thread={t}
            today=""
            contact={set.contacts[t.participantIds[0]]}
            query=""
            selected={t.id === selected}
            checked={false}
            selecting={false}
            onCheck={noop}
            onAction={noop}
            onPress={noop}
            summary={summaries ? t.summary : undefined}
          />
        </div>
      ))}
    </div>
  );
}

function DemoConversation({ set, messages }: { set: DemoSet; messages: Message[] }) {
  const handlers: BubbleHandlers = {
    whatsapp: set.open.whatsapp,
    nameOf: (who) => set.contacts[who]?.name ?? "You",
    onJump: noop, onReply: noop, onReact: noop, onOpen: noop, onRetry: noop, onDismiss: noop,
  };
  return (
    <div className="flex flex-col gap-3 px-3 py-4 md:px-4">
      {messages.map((m, i) => (
        <Bubble key={m.id} m={m} showMeta={messages[i + 1]?.from !== m.from} flash={false} {...handlers} />
      ))}
    </div>
  );
}

/** The reply card as the composer shows an AI draft: a placeholder line while it is written, then the text. */
function DemoComposer({ set, draft = set.draft, drafting = false }: { set: DemoSet; draft?: string; drafting?: boolean }) {
  return (
    <div className="p-3 md:px-4">
      <div className="mx-auto w-full max-w-2xl rounded-lg border bg-background p-3">
        <DraftBar busy={drafting} hasText={!!draft} editable={false} undoable={false} hasDraft draftLabel="Redraft" instruction="" onInstruction={noop} onDraft={noop} onFix={noop} onAskEdit={noop} onAdjust={noop} onUndo={noop} onDiscard={noop} />
        <Badge variant="secondary" className="mb-2">AI Draft</Badge>
        {/* Three lines tall from the start, so the card does not grow while the draft is written. */}
        <div className="min-h-15">
          {draft ? <p className="text-sm leading-5">{draft}</p> : <div className="flex h-5 items-center"><Skeleton className="h-3 w-3/5" /></div>}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" size="icon" aria-hidden><Paperclip /></Button>
          <Button disabled={drafting}>Send via {providerLabel[set.open.provider]}</Button>
        </div>
      </div>
    </div>
  );
}

const RAIL = [Search, Newspaper, Calendar, Inbox, Users, NotebookPen];

/** The whole app: rail, the trade's conversation list and its open chat. `live` plays the hero's story. */
export function DemoInbox({ demo = "estate", live = false }: { demo?: DemoKey; live?: boolean }) {
  const set = DEMO_SETS[demo];
  const [now] = useState(() => Date.now());
  const story = useLiveDemo(set, now, live);
  const threads = live ? story.threads : set.threads(now);
  const open = threads.find((t) => t.id === set.open.id)!;
  const who = set.contacts[open.participantIds[0]];
  return (
    <div className="flex h-full">
      <nav className="hidden shrink-0 flex-col gap-3 border-r p-3 md:flex">
        <div className="flex size-10 items-center justify-center"><Logo className="w-6" /></div>
        <div className="flex flex-col gap-1">
          {RAIL.map((Icon, i) => <Button key={i} variant={Icon === Inbox ? "secondary" : "ghost"} size="icon" className="size-10"><Icon /></Button>)}
        </div>
        <div className="mt-auto"><Button variant="ghost" size="icon" className="size-10"><Settings /></Button></div>
      </nav>
      <div className="flex h-full w-full shrink-0 flex-col md:w-80 lg:w-[38%]">
        <div className="flex h-16 shrink-0 items-center px-5 text-sm font-medium">Conversations</div>
        <DemoRows set={set} threads={threads} fresh={live ? story.freshIds : []} selected={open.id} />
      </div>
      <div className="hidden h-full min-w-0 flex-1 flex-col bg-muted/50 md:flex">
        <header className="flex shrink-0 items-center gap-2 p-3 md:px-4">
          <div className="relative shrink-0">
            <ContactAvatar contact={who} className="size-10" />
            <ProviderBadge provider={set.open.provider} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{who.name}</div>
            <div className="truncate text-xs text-muted-foreground">{set.open.channel}</div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden"><DemoConversation set={set} messages={set.messages(now)} /></div>
        <SummaryStrip summary={open.summary} />
        {live ? <DemoComposer set={set} draft={story.draft} drafting={story.drafting} /> : <DemoComposer set={set} />}
      </div>
    </div>
  );
}

/** The rows the AI marked, each with its one line summary: who is waiting and what about. */
export function DemoPriority({ demo = "estate", limit }: { demo?: DemoKey; limit?: number }) {
  const set = DEMO_SETS[demo];
  const all = set.threads(Date.now());
  const threads = set.priority.slice(0, limit).map((id) => all.find((t) => t.id === id)!);
  return <DemoRows set={set} threads={threads} summaries />;
}

/** The open chat's latest messages and the draft Konva wrote for them. */
export function DemoDraft({ demo = "estate" }: { demo?: DemoKey }) {
  const set = DEMO_SETS[demo];
  return (
    <div className="flex h-full flex-col justify-end bg-muted/50">
      <DemoConversation set={set} messages={set.messages(Date.now()).slice(-2)} />
      <DemoComposer set={set} />
    </div>
  );
}
