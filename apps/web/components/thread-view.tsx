"use client";

// One open conversation: header, message list and reply box, wired to the store. Used by /inbox and /summary.
// The parts are in thread-view/ (header, message-list, composer, scrolling); this file owns the hooks that tie them together.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, Loader2, Inbox, TriangleAlert } from "lucide-react";
import { useApp } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import type { Contact, Message } from "@/lib/types";
import { seenLabelId } from "@/lib/seen";
import { leaveHref, sideBySide } from "@/lib/thread-nav";
import { filterFits, filterOf, viewOf } from "@/lib/thread-list";
import { readKey, shouldAutoRead } from "@/lib/thread-read";
import { forwardDraft, headerOf } from "@/lib/thread-header";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/primitives";
import { useReactorName } from "@/components/message-extras";
import { isTypingKey } from "@/components/new-menu";
import { takeVia, track } from "@/lib/analytics";
import { MESSAGE_PAGE } from "@/lib/data";
import { meetingsAmong } from "@/lib/meetings";
import { useMeetings } from "@/components/meetings-data";
import { ShareNotice } from "@/components/share-notice";
import { SummaryStrip } from "@/components/thread-view/summary-strip";
import { CommitmentsStrip } from "@/components/commitments/commitments-strip";
import { ThreadHeader } from "@/components/thread-view/header";
import { Messages } from "@/components/thread-view/message-list";
import { Composer } from "@/components/thread-view/composer";
import { forgetForOtherUser } from "@/components/thread-view/composer-memory";
import { AttachmentsDialog } from "@/components/thread-view/attachments-dialog";
import { BubblesSkeleton, ConversationSkeleton } from "@/components/thread-view/skeletons";
import { useThreadScroll } from "@/components/thread-view/use-thread-scroll";
import { useConversationFiles } from "@/components/thread-view/use-conversation-files";

export { ConversationSkeleton };

// The viewer opens on a click on a file, so its code loads on its own the first time (as the Forward dialog does).
const AttachmentViewer = dynamic(() => import("@/components/attachments").then((m) => m.AttachmentViewer), { ssr: false });
// Forward dialog is rarely opened, so its code loads on its own (as in new-menu.tsx).
const ComposeDialog = dynamic(() => import("@/components/compose-dialog").then((m) => m.ComposeDialog), { ssr: false });

/** A conversation is marked read after it has been open this long in a visible tab. */
const READ_AFTER_MS = 2000;

/** basePath is where Back, Escape and archiving return: /inbox, or /summary when opened from the Summary page. */
export function ThreadView({ threadId, basePath = "/inbox" }: { threadId: string; basePath?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const focusId = params.get("message");
  const listQuery = new URLSearchParams(params);
  listQuery.delete("message");
  // A path in this view, keeping the list's filters and search so going back lands where you were.
  const withQuery = (path: string) => (listQuery.size ? `${path}?${listQuery.toString()}` : path);
  const backHref = withQuery(basePath);
  const {
    threadById, contactById, contacts, messagesFor, messagesLoaded, messagesFailed, listThreads, loadMessages, loadOlderMessages, loading, markRead,
    send, generateDraft, discardDraft, requestAutoDraft, drafting, hydrated, setReplyTo, react, hasOlder, removePending, retryPending,
  } = useApp();
  const thread = threadById(threadId);
  const { session } = useAuth();
  const authUser = session?.user.id ?? null;
  useEffect(() => { forgetForOtherUser(authUser); }, [authUser]);
  // The store keeps one list per conversation, which only changes when this conversation does.
  const stored = messagesFor(threadId);
  // Failed sends you have deleted, or retried as a new send, are hidden here.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const msgs = useMemo(() => (dismissed.size ? stored.filter((m) => !dismissed.has(m.id)) : stored), [stored, dismissed]);
  const loaded = messagesLoaded(threadId);
  const failed = messagesFailed(threadId);
  const phase = drafting[threadId];
  const rootRef = useRef<HTMLDivElement>(null);
  const threadExists = !!thread;
  const [filesOpen, setFilesOpen] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const nameOf = useReactorName(contacts);
  const { files, viewing, setViewing, viewerItems, viewerAt, viewerFile, viewerDetail } = useConversationFiles(msgs, contactById);
  const senderNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const m of msgs) if (m.from !== "me" && !out.has(m.from)) out.set(m.from, contactById(m.from)?.name ?? "Unknown");
    return out;
  }, [msgs, contactById]);
  const senderContacts = useMemo(() => {
    const out = new Map<string, Contact | undefined>();
    for (const m of msgs) if (m.from !== "me" && !out.has(m.from)) out.set(m.from, contactById(m.from));
    return out;
  }, [msgs, contactById]);
  // Once opened, the viewer stays mounted so closing it still animates.
  const viewerUsed = useRef(false);
  if (viewing) viewerUsed.current = true;
  const header = useMemo(() => (thread ? headerOf(thread, msgs, contactById) : null), [thread, msgs, contactById]);
  // Meetings that someone in this conversation was in, placed among its messages by when they started.
  const participantIds = thread?.participantIds;
  const meetingScope = useMemo(() => (participantIds ? { contactIds: participantIds } : null), [participantIds]);
  const { meetings: theirMeetings } = useMeetings(meetingScope);
  const meetings = useMemo(() => meetingsAmong(theirMeetings, msgs[0]?.sentAt, msgs.length < MESSAGE_PAGE), [theirMeetings, msgs]);

  // Opening a conversation: from where, and whether it had a summary to read first.
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!thread || openedRef.current === threadId) return;
    openedRef.current = threadId;
    track("thread_opened", { via: takeVia(basePath === "/summary" ? "summary" : "list"), channel: thread.channel, had_summary: thread.summary.length > 0, unread: thread.unread });
    void requestAutoDraft(threadId); // a pre-draft, when it qualifies and has none: ready while you read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, threadExists]);

  // Messages load when a conversation is opened, and then stay live.
  useEffect(() => {
    if (threadExists && !messagesLoaded(threadId)) loadMessages(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, threadExists]);

  // Marked read once per arrival (opening it, or a new message landing while it is open) after two seconds in a tab you
  // can see. Not whenever the unread flag flips: "Mark as Unread" on the open conversation has to stick (lib/thread-read.ts).
  const markedRef = useRef<string | null>(null);
  const unreadRef = useRef(false);
  unreadRef.current = !!thread?.unread;
  const arrival = thread ? readKey(threadId, thread.lastMessageAt) : null;
  useEffect(() => {
    if (!hydrated || !arrival || !shouldAutoRead(unreadRef.current, arrival, markedRef.current)) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(t);
      if (document.visibilityState === "visible") t = setTimeout(() => {
        if (!unreadRef.current) return;
        markedRef.current = arrival;
        markRead(threadId, true, true);
      }, READ_AFTER_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", arm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, hydrated, arrival]);

  // Archive or Delete from the menu: the next conversation opens beside the list (else the list), replacing this address.
  const onLeave = useCallback(() => {
    const view = viewOf(params.get("view"));
    const rawFilter = filterOf(params.get("filter"));
    const order = listThreads(view, filterFits(view, rawFilter) ? rawFilter : "none").map((t) => t.id);
    router.replace(leaveHref(order, [threadId], threadId, basePath, listQuery.toString(), sideBySide(), basePath === "/inbox"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listThreads, params, router, threadId, basePath]);

  const { scrollRef, newBelow, scrollToBottom, loadingOlder } = useThreadScroll({ threadId, threadExists, msgs, loaded, phase, hasOlder, loadOlderMessages });

  const [flashId, setFlashId] = useState<string | null>(null);
  const jumpTo = useCallback((id: string, smooth = false) => {
    scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    setFlashId(id);
  }, []);
  const onJump = useCallback((id: string) => jumpTo(id, true), [jumpTo]);
  const onReply = useCallback((m: Message) => {
    setReplyTo(threadId, m);
    rootRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [setReplyTo, threadId]);

  // Delete hides a failed send. Retry queues the same text again as a new send and hides the failed one.
  // The failed placeholder leaves the store too, so it does not come back when you return to the conversation.
  const onDismiss = useCallback((m: Message) => {
    setDismissed((d) => new Set(d).add(m.id));
    if (m.id.startsWith("outbox:")) removePending(m.id.slice("outbox:".length));
  }, [removePending]);
  // The store re-queues it with the same From address and Reply All recipients and removes the failed one itself.
  const onRetry = useCallback(async (m: Message) => {
    if (!m.id.startsWith("outbox:")) return;
    if (await retryPending(m.id.slice("outbox:".length))) setDismissed((d) => new Set(d).add(m.id));
  }, [retryPending]);

  // A message opened from search is scrolled to the middle and briefly ringed, once it is loaded: one older
  // than the loaded pages is loaded first. The param is then dropped so later sends still scroll to the
  // bottom and the same message can be searched again.
  const [focusLoaded, setFocusLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId || !loaded) return;
    if (focusLoaded !== focusId && !msgs.some((m) => m.id === focusId)) {
      let live = true;
      loadMessages(threadId, focusId).then(() => { if (live) setFocusLoaded(focusId); });
      return () => { live = false; };
    }
    setFilesOpen(false); // "Show in Conversation" from the Attachments panel lands here
    jumpTo(focusId);
    router.replace(withQuery(`${basePath}/${threadId}`), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, focusId, loaded, msgs, focusLoaded]);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 2000);
    return () => clearTimeout(t);
  }, [flashId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Keys typed in a field, menu, dialog or select (which jumps by letter) belong to that control.
      if (e.metaKey || e.ctrlKey || !thread || isTypingKey(e)) return;
      if (e.key === "r" && !e.altKey && !e.shiftKey) {
        // R starts a reply: the cursor goes to the message box. (E, #, !, U, J and K live in the list: thread-list/use-inbox-keys.ts.)
        e.preventDefault();
        rootRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [thread]);

  if (!thread || !header) {
    if (loading) return <ConversationSkeleton />;
    return <EmptyState icon={Inbox} title="Conversation Not Found" description="It may have been archived or deleted." action={<Button variant="secondary" asChild><Link href={basePath}>{basePath === "/inbox" ? "Back to Inbox" : "Go Back"}</Link></Button>} />;
  }
  const { primary, title, subtitle, address } = header;
  // Forward opens a new email with the latest stored message quoted. Files are not carried over.
  const forwardable = thread.channel === "email" && stored.some((m) => !m.sendState && !m.deleted);
  const forwardOf = forwardable ? forwardDraft(thread, stored) : undefined;

  return (
    // A solid header and composer, each set off by a line, with only the messages scrolling between them,
    // like the Conversations list.
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <ThreadHeader
        thread={thread}
        primary={primary}
        title={title}
        subtitle={subtitle}
        address={address}
        backHref={backHref}
        hrefFor={(id) => withQuery(`${basePath}/${id}`)}
        forwardable={forwardable}
        onLeave={onLeave}
        onAttachments={() => setFilesOpen(true)}
        onForward={() => setForwarding(true)}
      />
      <ShareNotice thread={thread} />
      <SummaryStrip summary={thread.summary} />
      <CommitmentsStrip threadId={thread.id} theirName={title} />

      {/* Padding sits outside the 672px column, as in the composer, so bubbles line up with the message box. */}
      <div className="relative min-h-0 flex-1">
      <ScrollArea ref={scrollRef} className="h-full">
        <div className="p-3 md:px-4">
          <div className="mx-auto w-full max-w-2xl">
            {!loaded && msgs.length === 0 ? (
              failed ? (
                <div className="h-72">
                  <EmptyState
                    icon={TriangleAlert}
                    title="Could Not Load Messages"
                    description="Check your connection and try again."
                    action={<Button variant="secondary" onClick={() => loadMessages(threadId)}>Retry</Button>}
                  />
                </div>
              ) : <BubblesSkeleton />
            ) : (
              <Messages
                msgs={msgs}
                meetings={meetings}
                isGroup={!!thread.isGroup}
                whatsapp={thread.channel === "whatsapp"}
                seenId={seenLabelId(msgs, thread.channel)}
                flashId={flashId}
                senderNames={senderNames}
                senderContacts={senderContacts}
                nameOf={nameOf}
                onJump={onJump}
                onReply={onReply}
                onReact={react}
                onOpen={setViewing}
                onRetry={onRetry}
                onDismiss={onDismiss}
              />
            )}
          </div>
        </div>
      </ScrollArea>
      {loadingOlder && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center" role="status" aria-label="Loading Earlier Messages">
          <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-xs">
            <Loader2 className="size-3.5 animate-spin" />Loading Earlier Messages
          </div>
        </div>
      )}
      {newBelow && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <Button variant="secondary" className="rounded-full shadow-md" onClick={() => scrollToBottom(true)}>
            <ArrowDown />New Messages
          </Button>
        </div>
      )}
      </div>

      <Composer
        thread={thread}
        phase={phase}
        onDraft={(tone, instruction, decision, source, audio) => generateDraft(thread.id, tone, instruction, decision, source, audio)}
        onDiscardDraft={() => discardDraft(thread.id)}
        msgs={msgs}
        onSend={(body, from, files, copies, sendAt) => send(thread.id, body, from, files, false, copies, sendAt)}
      />

      {(viewing || viewerUsed.current) && <AttachmentViewer
        attachment={viewing}
        detail={viewerDetail}
        sender={viewerFile ? { name: viewerFile.from === "me" ? "You" : contactById(viewerFile.from)?.name ?? "Unknown", contact: viewerFile.from === "me" ? undefined : contactById(viewerFile.from), me: viewerFile.from === "me" } : undefined}
        sentAt={viewerFile?.sentAt}
        items={viewerItems}
        index={viewerAt}
        onNavigate={(i) => { if (viewerItems[i]) setViewing(viewerItems[i]); }}
        onClose={() => setViewing(null)}
      />}

      {forwardOf && <ComposeDialog open={forwarding} onOpenChange={setForwarding} subject={forwardOf.subject} body={forwardOf.body} />}

      <AttachmentsDialog
        open={filesOpen}
        onOpenChange={setFilesOpen}
        files={files}
        hrefFor={(a) => {
          const q = new URLSearchParams(listQuery);
          q.set("message", a.messageId);
          return `${basePath}/${a.threadId}?${q.toString()}`;
        }}
      />
    </div>
  );
}
