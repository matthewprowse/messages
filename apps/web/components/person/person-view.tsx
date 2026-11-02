"use client";

// One person, one conversation: the combined timeline of their email, WhatsApp, LinkedIn and Instagram messages in date order,
// with a reply box that goes out on the channel you pick (their last message's channel to begin with). Opening it only loads
// messages; nothing is marked read (a read receipt goes out on WhatsApp), until the user opens one conversation from a badge.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Inbox } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Message } from "@/lib/types";
import { niceName } from "@/lib/format";
import { buildTimeline, lastIncomingThread, personThreads, replyOptions } from "@/lib/person-timeline";
import { matterGroups, pendingSuggestions, type ThreadLink } from "@/lib/thread-links";
import { useThreadLinks } from "@/lib/use-thread-links";
import { track } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContactAvatar, EmptyState } from "@/components/primitives";
import { useReactorName } from "@/components/message-extras";
import { Composer } from "@/components/thread-view/composer";
import { BubblesSkeleton } from "@/components/thread-view/skeletons";
import { useConversationFiles } from "@/components/thread-view/use-conversation-files";
import { ChannelMarks } from "@/components/person/channel-mark";
import { MatterSuggestions } from "@/components/person/matter-suggestions";
import { PersonTimeline } from "@/components/person/person-timeline";
import { ReplyChannel } from "@/components/person/reply-channel";

const AttachmentViewer = dynamic(() => import("@/components/attachments").then((m) => m.AttachmentViewer), { ssr: false });

export function PersonView({ personId }: { personId: string }) {
  const params = useSearchParams();
  const {
    threads, contacts, contactById, loading, prefetchMessages, loadMessages, messagesByThread, messagesLoaded, send, generateDraft, discardDraft, drafting,
    react, setReplyTo, removePending, retryPending,
  } = useApp();
  const person = contactById(personId);
  const mine = useMemo(() => personThreads(threads, personId), [threads, personId]);
  const ids = useMemo(() => mine.map((t) => t.id), [mine]);
  const idKey = ids.join(",");
  const messagesOf = useMemo(() => (id: string) => messagesByThread.get(id) ?? [], [messagesByThread]);

  // Reading their messages is a load from the database; it sends no read receipt (only markRead does, in an open conversation).
  useEffect(() => { for (const id of idKey ? idKey.split(",") : []) prefetchMessages(id); }, [idKey, prefetchMessages]);
  const opened = useRef(false);
  useEffect(() => {
    if (mine.length === 0 || opened.current) return;
    opened.current = true;
    track("feature_used", { feature: "person_view", detail: String(Math.min(new Set(mine.map((t) => t.channel)).size, 4)) });
  }, [mine]);

  // Same Matter: linked conversations show together, and a suggestion waits for a yes or no.
  const { links, decide } = useThreadLinks(ids);
  const matters = useMemo(() => matterGroups(links, ids), [links, ids]);
  const suggestions = useMemo(() => pendingSuggestions(links, ids), [links, ids]);
  const blocks = useMemo(() => buildTimeline(mine, messagesOf, matters), [mine, messagesOf, matters]);
  const onUnlink = (threadIds: string[]) => {
    const inside = new Set(threadIds);
    for (const l of links) if (l.status === "linked" && inside.has(l.threadA) && inside.has(l.threadB)) void decide(l, "dismissed");
  };

  // The reply goes to the channel of their last message until you pick another; the pick sticks.
  const preferred = useMemo(() => lastIncomingThread(mine, messagesOf), [mine, messagesOf]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const options = useMemo(() => replyOptions(mine, mine.find((t) => t.id === chosenId) ?? preferred), [mine, chosenId, preferred]);
  const target = mine.find((t) => t.id === chosenId) ?? preferred;
  const targetId = target?.id;
  useEffect(() => { if (targetId && !messagesLoaded(targetId)) void loadMessages(targetId); }, [targetId, messagesLoaded, loadMessages]);

  const allMessages = useMemo(() => blocks.flatMap((b) => b.entries.map((e) => e.message)), [blocks]);
  const { viewing, setViewing, viewerItems, viewerAt, viewerFile, viewerDetail } = useConversationFiles(allMessages, contactById);
  const nameOf = useReactorName(contacts);

  // Down to the newest message when the timeline first fills and whenever a newer one arrives.
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = allMessages[allMessages.length - 1]?.id;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [lastId]);

  const backQuery = new URLSearchParams(params).toString();
  const backHref = backQuery ? `/inbox?${backQuery}` : "/inbox";
  const loaded = mine.length > 0 && mine.every((t) => messagesLoaded(t.id));

  if (!person || mine.length === 0 || !target) {
    if (loading) return <div className="p-4"><BubblesSkeleton /></div>;
    return <EmptyState icon={Inbox} title="Nobody Found" description="This person has no conversations in your Inbox." action={<Button variant="secondary" asChild><Link href="/inbox">Back to Inbox</Link></Button>} />;
  }
  const title = niceName(person.name);
  const channels = [...new Set(mine.map((t) => t.channel))];
  const onReply = (m: Message) => {
    setReplyTo(m.threadId, m);
    setChosenId(m.threadId);
  };
  const retry = async (m: Message) => { if (m.id.startsWith("outbox:")) await retryPending(m.id.slice("outbox:".length)); };
  const dismiss = (m: Message) => { if (m.id.startsWith("outbox:")) removePending(m.id.slice("outbox:".length)); };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b bg-background p-3 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back"><Link href={backHref}><ArrowLeft /></Link></Button>
        <Link href={`/contacts/${person.id}`} aria-label={`View ${title}`} className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <ContactAvatar contact={person} className="size-8" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium">{title}</span>
              <ChannelMarks channels={channels} />
            </div>
            <div className="truncate text-xs text-muted-foreground">{mine.length} {mine.length === 1 ? "Conversation" : "Conversations"}</div>
          </div>
        </Link>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3 md:px-4">
          <div className="mx-auto w-full max-w-2xl">
            <MatterSuggestions suggestions={suggestions} threads={mine} onLink={(l: ThreadLink) => void decide(l, "linked")} onDismiss={(l: ThreadLink) => void decide(l, "dismissed")} />
            {!loaded && allMessages.length === 0 ? <BubblesSkeleton /> : (
              <PersonTimeline blocks={blocks} nameOf={nameOf} onReply={onReply} onReact={react} onOpen={setViewing} onRetry={retry} onDismiss={dismiss} onUnlink={onUnlink} />
            )}
            <div ref={endRef} aria-hidden className="h-px" />
          </div>
        </div>
      </ScrollArea>

      <ReplyChannel options={options} target={target} onPick={(t) => setChosenId(t.id)} />
      <Composer
        thread={target}
        msgs={messagesOf(target.id)}
        phase={drafting[target.id]}
        onDraft={(tone, instruction, decision, source, audio) => generateDraft(target.id, tone, instruction, decision, source, audio)}
        onDiscardDraft={() => discardDraft(target.id)}
        onSend={(body, from, files, copies, sendAt) => send(target.id, body, from, files, false, copies, sendAt)}
      />

      <AttachmentViewer
        attachment={viewing}
        detail={viewerDetail}
        sender={viewerFile ? { name: viewerFile.from === "me" ? "You" : contactById(viewerFile.from)?.name ?? "Unknown", contact: viewerFile.from === "me" ? undefined : contactById(viewerFile.from), me: viewerFile.from === "me" } : undefined}
        sentAt={viewerFile?.sentAt}
        items={viewerItems}
        index={viewerAt}
        onNavigate={(i) => { if (viewerItems[i]) setViewing(viewerItems[i]); }}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}
