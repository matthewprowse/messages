"use client";

// One open conversation: the message bubbles, header and menus, and the reply box with drafts. Used by /inbox and /summary.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, Check, CheckCheck, ChevronDown, Loader2, MoreHorizontal, X, Inbox, Paperclip } from "lucide-react";
import { useApp, type DraftPhase } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import type { Attachment, Contact, Decision, Draft, FiledAttachment, Message, Thread } from "@/lib/types";
import { dayLabel, formatPhone, fullStamp, niceName, relTime, timeOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { seenLabelId } from "@/lib/seen";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ContactAvatar, ThreadAvatar, EmptyState, providerLabel } from "@/components/primitives";
import { ProviderLogo } from "@/components/provider-logo";
import { AttachmentGrid, AttachmentTile, AttachmentViewer, StickerImage, isSticker } from "@/components/attachments";
import { MessageBody, hasFullText } from "@/components/message-body";
import { VoiceNote } from "@/components/media-player";
import { GuidedChoices } from "@/components/guided-choices";
import { BubbleActions, QuoteBlock, ReactionChips, useReactorName, useTouchReveal, type NameOf, type OnReact } from "@/components/message-extras";
import { ReplyHeader, useReplyAll, useReplyFrom } from "@/components/reply-header";
import { AttachButton, AttachmentChips, useOutboxFiles } from "@/components/outbox-attachments";
import { RecordButton, RecordingActions, RecordingStatus, useVoiceRecorder } from "@/components/voice-recorder";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TemplatePicker } from "@/components/template-picker";
import { isTypingKey } from "@/components/new-menu";
import { takeVia, track } from "@/lib/analytics";
import { attachProvider, type OutboxUpload } from "@/lib/outbox-files";
import { MESSAGE_PAGE } from "@/lib/data";
import { meetingsAmong, type Meeting } from "@/lib/meetings";
import { useMeetings } from "@/components/meetings-data";
import { MeetingCard } from "@/components/meeting-card";
import { ThreadShare } from "@/components/work-badge";
import { ShareNotice } from "@/components/share-notice";
import { InstagramReplyNotice, useInstagramReplyClosed } from "@/components/instagram-window";

// Forward and new-email dialogs are rarely opened, so their code loads on its own (as in new-menu.tsx).
const ComposeDialog = dynamic(() => import("@/components/compose-dialog").then((m) => m.ComposeDialog), { ssr: false });

/** A conversation is marked read after it has been open this long in a visible tab. */
const READ_AFTER_MS = 2000;
/** Within this many pixels of the end of the list counts as being at the bottom. */
const NEAR_BOTTOM_PX = 120;

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
    threadById, contactById, contacts, messagesFor, messagesLoaded, loadMessages, loadOlderMessages, loading, markRead, archive, trash, pin, giveFeedback,
    send, generateDraft, discardDraft, requestAutoDraft, setJunk, drafting, hydrated, setReplyTo, react, hasOlder, removePending,
  } = useApp();
  const thread = threadById(threadId);
  const { session } = useAuth();
  const authUser = session?.user.id ?? null;
  useEffect(() => {
    if (remembersFor !== undefined && remembersFor !== authUser) { typedText.clear(); beforeAsk.clear(); }
    remembersFor = authUser;
  }, [authUser]);
  // The store keeps one list per conversation, which only changes when this conversation does.
  const stored = messagesFor(threadId);
  // Failed sends you have deleted, or retried as a new send, are hidden here.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const msgs = useMemo(() => (dismissed.size ? stored.filter((m) => !dismissed.has(m.id)) : stored), [stored, dismissed]);
  const loaded = messagesLoaded(threadId);
  const phase = drafting[threadId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const threadExists = !!thread;
  const [filesOpen, setFilesOpen] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  // One viewer for the whole conversation, opened by any bubble's attachment.
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const files = useMemo(
    () => msgs.flatMap((m) => (m.attachments ?? []).map<FiledAttachment>((a) => ({ ...a, messageId: m.id, threadId: m.threadId, sentAt: m.sentAt, from: m.from }))).reverse(),
    [msgs],
  );
  const nameOf = useReactorName(contacts);
  // Who sent the open file, and when, for the top of the viewer; and its place among the conversation's files.
  // Next and Previous stay among the pictures while one is open, rather than running on into stickers, voice notes and documents.
  const isPicture = (f: Attachment) => f.kind === "image" && !isSticker(f);
  const viewerItems = useMemo(() => (viewing && isPicture(viewing) ? files.filter(isPicture) : files), [files, viewing]);
  const viewerAt = viewing ? viewerItems.findIndex((f) => f.id === viewing.id) : -1;
  const viewerFile = viewerAt >= 0 ? viewerItems[viewerAt] : undefined;
  const viewerDetail = viewerFile ? `${viewerFile.from === "me" ? "You" : contactById(viewerFile.from)?.name ?? "Unknown"} · ${fullStamp(viewerFile.sentAt)}` : undefined;
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

  useEffect(() => {
    if (!hydrated || !thread?.unread) return;
    // Read only once it has been open for two seconds in a tab you can see: not while it sits in the background.
    let t: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(t);
      if (document.visibilityState === "visible") t = setTimeout(() => markRead(threadId, true, true), READ_AFTER_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", arm);
    };
    // Re-checked once the conversation has loaded, and when a new message makes it unread again while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, hydrated, threadExists, thread?.unread, thread?.lastMessageAt]);

  // New messages at the bottom scroll into view when you are already near the bottom (or sent them
  // yourself); otherwise a New Messages button offers the jump. Older ones loaded at the top do not scroll.
  const lastId = msgs[msgs.length - 1]?.id;
  const lastMine = msgs[msgs.length - 1]?.from === "me";
  const nearBottom = useRef(true);
  const seenLast = useRef<{ threadId: string; id: string | undefined } | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const scrollToBottom = useCallback((smooth = false) => {
    const el = viewportOf(scrollRef.current);
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewBelow(false);
  }, []);
  useEffect(() => {
    const el = viewportOf(scrollRef.current);
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      nearBottom.current = near;
      if (near) setNewBelow(false);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [threadId, threadExists]);
  useEffect(() => { nearBottom.current = true; setNewBelow(false); }, [threadId]);
  useEffect(() => {
    const prev = seenLast.current;
    seenLast.current = { threadId, id: lastId };
    // Opening a conversation, or its first messages arriving, goes to the bottom.
    const opening = !prev || prev.threadId !== threadId || prev.id === undefined;
    if (opening || nearBottom.current || lastMine) scrollToBottom();
    else if (prev.id !== lastId) setNewBelow(true);
  }, [threadId, lastId, lastMine, scrollToBottom]);
  // A reply being drafted grows the list at the bottom: follow it only when already there.
  useEffect(() => { if (phase && nearBottom.current) scrollToBottom(); }, [phase, scrollToBottom]);

  // Scrolling near the top loads the page before, and keeps the message that was first in view where it
  // was. Measured from that message, so it holds whether or not the browser's own scroll anchoring acts.
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const firstId = msgs[0]?.id;
  const [loadingOlder, setLoadingOlder] = useState(false);
  useLayoutEffect(() => {
    const el = viewportOf(scrollRef.current);
    const a = anchor.current;
    const node = a && el?.querySelector(`[data-message-id="${CSS.escape(a.id)}"]`);
    if (el && a && node) el.scrollTop += node.getBoundingClientRect().top - a.top;
    anchor.current = null;
  }, [firstId]);
  useEffect(() => {
    const el = viewportOf(scrollRef.current);
    if (!el || !loaded) return;
    function onScroll() {
      const first = el?.querySelector("[data-message-id]");
      if (!el || !first || el.scrollTop > 400 || anchor.current || !hasOlder(threadId)) return;
      anchor.current = { id: first.getAttribute("data-message-id")!, top: first.getBoundingClientRect().top };
      setLoadingOlder(true);
      loadOlderMessages(threadId)
        .then((added) => { if (!added) anchor.current = null; })
        .finally(() => setLoadingOlder(false));
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      anchor.current = null;
      setLoadingOlder(false);
    };
  }, [threadId, loaded, threadExists, loadOlderMessages, hasOlder]);

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
  const onRetry = useCallback(async (m: Message) => {
    if (await send(threadId, m.body, undefined, [], true)) onDismiss(m);
  }, [send, threadId, onDismiss]);

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
        // R starts a reply: the cursor goes to the message box.
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
  const { primary, title, subtitle } = header;
  // Forward opens a new email with the latest stored message quoted. Files are not carried over.
  const forwardable = thread.channel === "email" && stored.some((m) => !m.sendState && !m.deleted);
  const forwardOf = forwardable ? forwardDraft(thread, stored) : undefined;

  return (
    // A solid header and composer, each set off by a line, with only the messages scrolling between them,
    // like the Conversations list.
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b bg-background p-3 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back">
          <Link href={backHref}><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          {/* The avatar and name open the person's contact page. */}
          {(() => {
            const who = (
              <>
                <ThreadAvatar thread={thread} contacts={contactById} className="size-8" />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{title}</span>
                    <ProviderLogo provider={thread.provider} />
                  </div>
                  {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
                </div>
              </>
            );
            const cls = "flex w-fit max-w-full min-w-0 items-center gap-3";
            return primary
              ? <Link href={`/contacts/${primary.id}`} aria-label={`View ${title}`} className={cn(cls, "rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}>{who}</Link>
              : <div className={cls}>{who}</div>;
          })()}
        </div>
        <ChannelTabs thread={thread} person={primary} hrefFor={(id) => withQuery(`${basePath}/${id}`)} />
        <ThreadShare thread={thread} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="secondary" size="icon" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max">
            <DropdownMenuItem onClick={() => pin(thread.id, !thread.pinned)}>{thread.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { archive(thread.id); router.push(backHref); }}>Archive</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { trash(thread.id); router.push(backHref); }}>Delete</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilesOpen(true)}>Attachments</DropdownMenuItem>
            {forwardable && <DropdownMenuItem onClick={() => setForwarding(true)}>Forward</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => giveFeedback(thread.id, "important")}>Important</DropdownMenuItem>
            <DropdownMenuItem onClick={() => giveFeedback(thread.id, "not_important")}>Not Important</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setJunk(thread.id, !thread.junk)}>{thread.junk ? "Not Junk" : "Move to Junk"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/settings/personalisation?add=${encodeURIComponent(primary?.emails[0] ?? primary?.phones[0] ?? "")}#priorities`}>Add Priority Rule</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <ShareNotice thread={thread} />

      {/* Padding sits outside the 672px column, as in the composer, so bubbles line up with the message box. */}
      <div className="relative min-h-0 flex-1">
      <ScrollArea ref={scrollRef} className="h-full">
        <div className="p-3 md:px-4">
          <div className="mx-auto w-full max-w-2xl">
            {!loaded && msgs.length === 0 ? (
              <BubblesSkeleton />
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
        onSend={(body, from, files, copies) => send(thread.id, body, from, files, false, copies)}
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

      {forwardOf && <ComposeDialog open={forwarding} onOpenChange={setForwarding} subject={forwardOf.subject} body={forwardOf.body} />}

      <Dialog open={filesOpen} onOpenChange={setFilesOpen}>
        <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Attachments</DialogTitle>
            <DialogDescription>{files.length === 1 ? "1 file" : `${files.length} files`} in this conversation</DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0">
            {files.length === 0 ? (
              <EmptyState icon={Paperclip} title="No Attachments" description="Files sent in this conversation appear here." />
            ) : (
              <AttachmentGrid
                items={files}
                hrefFor={(a) => {
                  const q = new URLSearchParams(listQuery);
                  q.set("message", a.messageId);
                  return `${basePath}/${a.threadId}?${q.toString()}`;
                }}
              />
            )}
          </ScrollArea>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The places you talk to this person, beside the More menu. Email opens a menu of your email threads with
 * them, newest first with the open one ticked, and New Email to start a fresh one, since a new topic does
 * not belong in an old thread. WhatsApp opens your chat with them. Shown when there is somewhere to go.
 */
function ChannelTabs({ thread, person, hrefFor }: { thread: Thread; person?: Contact; hrefFor: (threadId: string) => string }) {
  const { threads } = useApp();
  const [composing, setComposing] = useState(false);
  const { emails, chat } = useMemo(() => {
    const theirs = person ? threads.filter((t) => !t.isGroup && t.status !== "trash" && t.participantIds.includes(person.id)) : [];
    const newest = (a: Thread, b: Thread) => b.lastMessageAt.localeCompare(a.lastMessageAt);
    return { emails: theirs.filter((t) => t.channel === "email").sort(newest), chat: theirs.filter((t) => t.channel === "whatsapp").sort(newest)[0] };
  }, [threads, person]);
  const address = person?.emails[0];
  const canEmail = emails.length > 0 || !!address;
  const onEmail = thread.channel === "email";
  const onChat = thread.channel === "whatsapp";
  // In an email: another thread, a new email or their chat. In a chat: any way to email them.
  const somewhere = onEmail ? !!chat || !!address || emails.length > 1 : canEmail;
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
      {chat && (
        <Button asChild variant={onChat ? "secondary" : "ghost"} className={cn("px-2", !onChat && "text-muted-foreground")}>
          <Link href={hrefFor(chat.id)} aria-current={onChat ? "page" : undefined}>WhatsApp</Link>
        </Button>
      )}
      {address && <ComposeDialog open={composing} onOpenChange={setComposing} to={[address]} />}
    </nav>
  );
}

/** A forward of the latest message: its subject and the message quoted below an empty space for a note. */
function forwardDraft(thread: Thread, msgs: Message[]) {
  const m = [...msgs].reverse().find((x) => !x.sendState && !x.deleted);
  const subject = thread.subject?.trim() ?? "";
  const lines = [
    "",
    "",
    "Begin forwarded message:",
    "",
    ...(m?.address ? [`From: ${m.address}`] : []),
    ...(m ? [`Date: ${fullStamp(m.sentAt)}`] : []),
    ...(subject ? [`Subject: ${subject}`] : []),
    "",
    m?.body ?? "",
  ];
  return { subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`.trim(), body: lines.join("\n") };
}

function viewportOf(root: HTMLElement | null) {
  return root?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;
}

const phoneOf = (n: string | undefined) => (n ? formatPhone(n) : undefined);

/** The name, subtitle and contact shown at the top of a conversation. */
function headerOf(thread: Thread, msgs: Message[], contactById: (id: string) => Contact | undefined) {
  const primary = thread.isGroup ? undefined : contactById(thread.participantIds[0]);
  const title = niceName((thread.isGroup ? thread.groupName : primary?.name ?? thread.fallbackName) ?? "Unknown");
  // Who you are really talking to: the address their latest message came from, or their number.
  let lastAddress: string | undefined;
  for (let i = msgs.length - 1; i >= 0 && !lastAddress; i--) if (msgs[i].from !== "me") lastAddress = msgs[i].address;
  const subtitle = thread.isGroup
    ? groupMembers(thread.participantIds, msgs, contactById)
    : thread.channel === "email"
      ? lastAddress ?? primary?.emails[0]
      : thread.channel === "instagram"
        ? primary?.handles?.[0] && `@${primary.handles[0]}`
        : phoneOf(primary?.phones[0] ?? (lastAddress?.includes("@") ? undefined : lastAddress));
  return { primary, title, subtitle };
}

interface ListProps {
  msgs: Message[];
  /** Meetings with these people, oldest first, shown as cards between the messages around them. */
  meetings: Meeting[];
  isGroup: boolean;
  whatsapp: boolean;
  /** The one message that shows "Seen" (Instagram and LinkedIn). */
  seenId: string | null;
  flashId: string | null;
  senderNames: Map<string, string>;
  senderContacts: Map<string, Contact | undefined>;
  nameOf: NameOf;
  onJump: (id: string) => void;
  onReply: (m: Message) => void;
  onReact: OnReact;
  onOpen: (a: Attachment) => void;
  onRetry: (m: Message) => void;
  onDismiss: (m: Message) => void;
}

/** How close together photos must be sent to show as one album, as WhatsApp groups them. */
const ALBUM_GAP_MS = 2 * 60_000;

/** A photo sent on its own: images only (no stickers), no words, no quote, not deleted or still sending. */
function photoOnly(m: Message) {
  return !!m.attachments?.length && m.attachments.every((a) => a.kind === "image" && !isSticker(a))
    && !m.body.trim() && !m.quote && !m.quoted && !m.deleted && !m.sendState;
}

/** A run's messages, with photos sent one after another within a couple of minutes gathered into albums. */
function withAlbums(run: Message[]): Message[][] {
  const out: Message[][] = [];
  for (const m of run) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && photoOnly(prev) && photoOnly(m) && Date.parse(m.sentAt) - Date.parse(prev.sentAt) <= ALBUM_GAP_MS) last.push(m);
    else out.push([m]);
  }
  return out;
}

/* Every conversation renders as a chat, email included. */
const Messages = memo(function Messages({ msgs, meetings, isGroup, whatsapp, seenId, flashId, senderNames, senderContacts, ...handlers }: ListProps) {
  // A WhatsApp quote names the quoted message by WhatsApp's own ID.
  const byProviderId = useMemo(() => new Map(msgs.flatMap((m) => (m.providerId ? [[m.providerId, m.id] as const] : []))), [msgs]);
  // Split each day into runs of consecutive messages from the same sender, with a meeting between the messages
  // sent before and after it starts (and so ending a run). The label is worked out once per day.
  const groups = useMemo(() => {
    const now = new Date();
    const out: { key: string; day: string; runs: (Message[] | Meeting)[] }[] = [];
    const dayOf = (iso: string) => {
      const key = new Date(iso).toDateString();
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, day: dayLabel(iso, now), runs: [] };
        out.push(g);
      }
      return g;
    };
    let next = 0;
    for (const m of msgs) {
      while (next < meetings.length && Date.parse(meetings[next].startedAt) <= Date.parse(m.sentAt)) {
        dayOf(meetings[next].startedAt).runs.push(meetings[next]);
        next++;
      }
      const g = dayOf(m.sentAt);
      const run = g.runs[g.runs.length - 1];
      if (Array.isArray(run) && run[0].from === m.from) run.push(m);
      else g.runs.push([m]);
    }
    for (; next < meetings.length; next++) dayOf(meetings[next].startedAt).runs.push(meetings[next]);
    return out;
  }, [msgs, meetings]);
  return (
    <div className="space-y-6" role="log" aria-live="polite" aria-label="Messages">
      {groups.map((g) => (
        <div key={g.key} className="space-y-6">
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">{g.day}</span>
            <Separator className="flex-1" />
          </div>
          {g.runs.map((run) => {
            if (!Array.isArray(run)) return <MeetingCard key={run.id} meeting={run} place="conversation" />;
            const items = whatsapp ? withAlbums(run) : run.map((m) => [m]);
            return (
              <div key={run[0].id} className="flex flex-col gap-2">
                {items.map((ms, i) => {
                  const m = ms[ms.length - 1];
                  const shared = {
                    showMeta: i === items.length - 1,
                    sender: isGroup && m.from !== "me" ? senderNames.get(m.from) : undefined,
                    senderContact: isGroup && m.from !== "me" ? senderContacts.get(m.from) : undefined,
                    whatsapp,
                    seen: m.id === seenId,
                    ...handlers,
                  };
                  return ms.length > 1
                    ? <ImageAlbum key={ms[0].id} ms={ms} flash={ms.some((x) => x.id === flashId)} {...shared} />
                    : <Bubble key={m.id} m={m} flash={flashId === m.id} quotedId={m.quote ? byProviderId.get(m.quote.id) : undefined} {...shared} />;
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});

interface BubbleProps extends Pick<ListProps, "whatsapp" | "nameOf" | "onJump" | "onReply" | "onReact" | "onOpen" | "onRetry" | "onDismiss"> {
  m: Message;
  showMeta: boolean;
  /** Shows "Seen" under it: the last message you sent that the other person has seen. */
  seen?: boolean;
  /** The sender's name and photo, shown in groups. */
  sender?: string;
  senderContact?: Contact;
  flash: boolean;
  quotedId?: string;
}

// Memoised with stable props, so a new message or a reaction redraws only the bubbles it changes.
const Bubble = memo(function Bubble({ m, showMeta, seen, sender, senderContact, whatsapp, flash, quotedId, nameOf, onJump, onReply, onReact, onOpen, onRetry, onDismiss }: BubbleProps) {
  const touch = useTouchReveal();
  const me = m.from === "me";
  const bulk = !!m.bulk;
  const [showFull, setShowFull] = useState(false);
  const expandable = hasFullText(m, whatsapp, bulk);
  // A sticker, photo or file sent with no words shows on its own, without an empty bubble.
  const showBubble = !!(m.body.trim() || m.quoted || m.quote || !m.attachments?.length);
  // Replies and reactions need a stored message: not one still sending, and not one its sender deleted.
  const actions = !m.sendState && !m.deleted ? <BubbleActions m={m} canReact={whatsapp} revealed={touch.revealed} onReply={onReply} onReact={onReact} expand={expandable ? { open: showFull, toggle: () => setShowFull((v) => !v) } : undefined} /> : null;
  return (
    <div ref={touch.ref} {...touch.props} data-message-id={m.id} className={cn("group/bubble flex flex-col gap-2", me ? "items-end" : "items-start")}>
      {m.attachments && m.attachments.length > 0 && (
        <div className={cn("flex max-w-full items-center gap-1", me && "flex-row-reverse")}>
          <div className={cn("flex flex-wrap gap-2", me && "justify-end")}>
            {m.attachments.map((a) =>
              isSticker(a) && a.path
                ? <StickerImage key={a.id} attachment={a} onOpen={() => onOpen(a)} />
                : a.kind === "audio"
                  ? <VoiceNote key={a.id} attachment={a} me={me} transcript={m.transcript} />
                  : <AttachmentTile key={a.id} attachment={a} onOpen={() => onOpen(a)} showName={!(whatsapp && a.kind === "image")} />,
            )}
          </div>
          {!showBubble && actions}
        </div>
      )}
      {showBubble && (
        <div className={cn("flex max-w-[80%] items-center gap-1", me && "flex-row-reverse")}>
          <div className={cn("min-w-0 rounded-lg p-3 text-sm leading-6 ring-ring/50 transition-shadow duration-500", me ? "rounded-br-[2px] bg-primary text-primary-foreground" : "rounded-bl-[2px] bg-muted", flash && "ring-2")}>
            {m.quote && <QuoteBlock quote={m.quote} me={me} nameOf={nameOf} onJump={quotedId ? () => onJump(quotedId) : undefined} />}
            {/* Email text is always shown as plain text. Sender-supplied HTML never reaches the page. */}
            {m.deleted ? <p className="opacity-70">{m.body}</p> : <MessageBody m={m} whatsapp={whatsapp} bulk={bulk} showFull={showFull} />}
          </div>
          {actions}
        </div>
      )}
      {/* Received messages show their reactions on the line below, after the name, date and time. */}
      {(me || !showMeta) && <ReactionChips m={m} me={me} nameOf={nameOf} onReact={onReact} />}
      {m.sendState === "failed" ? (
        <div className="flex flex-wrap items-center gap-1 px-3 text-xs text-destructive">
          <span>{m.sendError ?? "Not Sent"}</span>
          {/* Files cannot be re-queued from here, so a failed send with files can only be deleted. */}
          {!m.attachments?.length && <Button variant="ghost" size="xs" onClick={() => onRetry(m)}>Retry</Button>}
          <Button variant="ghost" size="xs" onClick={() => onDismiss(m)}>Delete</Button>
        </div>
      ) : m.sendState === "sending" ? (
        <div className="px-3 text-xs text-muted-foreground">Sending</div>
      ) : (
        (showMeta || m.edited || (me && (whatsapp ? m.receipt : seen))) && (
          <div className="flex items-center gap-1.5 px-3 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              {sender && showMeta && <ContactAvatar contact={senderContact} className="size-6" />}
              <span className="truncate">
                {showMeta ? (sender ? `${sender} · ${timeOf(m.sentAt)}` : timeOf(m.sentAt)) : ""}
                {m.edited ? (showMeta ? " · Edited" : "Edited") : ""}
              </span>
              {me && (whatsapp ? m.receipt && <Ticks receipt={m.receipt} /> : seen && <span>Seen</span>)}
            </span>
            {!me && showMeta && <ReactionChips m={m} me={false} nameOf={nameOf} onReact={onReact} inline />}
          </div>
        )
      )}
    </div>
  );
});

/** WhatsApp's ticks under a message you sent: one for sent, two for delivered, two in blue once read. */
function Ticks({ receipt }: { receipt: NonNullable<Message["receipt"]> }) {
  const Icon = receipt === "sent" ? Check : CheckCheck;
  const label = receipt === "read" ? "Read" : receipt === "delivered" ? "Delivered" : "Sent";
  return <Icon className={cn("size-3.5 shrink-0", receipt === "read" && "text-blue-500")} aria-label={label} />;
}

/**
 * Photos sent together, as WhatsApp shows them: one grid, two to a row. Each photo keeps its own reactions;
 * Reply and React act on the last one, and the time is the last one's.
 */
const ImageAlbum = memo(function ImageAlbum({ ms, showMeta, sender, senderContact, whatsapp, flash, nameOf, onReply, onReact, onOpen }: Omit<BubbleProps, "m" | "quotedId" | "onJump" | "onRetry" | "onDismiss"> & { ms: Message[] }) {
  const touch = useTouchReveal();
  const last = ms[ms.length - 1];
  const me = last.from === "me";
  return (
    <div ref={touch.ref} {...touch.props} data-message-id={last.id} className={cn("group/bubble flex flex-col gap-2", me ? "items-end" : "items-start")}>
      <div className={cn("flex max-w-full items-center gap-1", me && "flex-row-reverse")}>
        <div className={cn("grid grid-cols-2 gap-2 rounded-lg ring-ring/50 transition-shadow duration-500", flash && "ring-2")}>
          {ms.flatMap((m) => m.attachments!.map((a) => (
            <AttachmentTile key={a.id} attachment={a} onOpen={() => onOpen(a)} showName={false} />
          )))}
        </div>
        <BubbleActions m={last} canReact={whatsapp} revealed={touch.revealed} onReply={onReply} onReact={onReact} />
      </div>
      {ms.map((m) => <ReactionChips key={m.id} m={m} me={me} nameOf={nameOf} onReact={onReact} />)}
      {showMeta && (
        <div className="flex items-center gap-1.5 px-3 text-xs text-muted-foreground">
          {sender && <ContactAvatar contact={senderContact} className="size-6" />}
          {sender ? `${sender} · ${timeOf(last.sentAt)}` : timeOf(last.sentAt)}
        </div>
      )}
    </div>
  );
});

/** "Sarah, Tom and Lee": every person in a group, from its members and everyone who has written in it. */
function groupMembers(participantIds: string[], msgs: Message[], contactById: (id: string) => { name: string } | undefined) {
  const ids = new Set(participantIds);
  for (const m of msgs) if (m.from !== "me" && m.from !== "unknown") ids.add(m.from);
  const names = [...ids].map((id) => contactById(id)?.name?.trim()).filter((n): n is string => !!n);
  if (names.length === 0) return undefined;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

/** Placeholder bubbles while a conversation's messages load. */
function BubblesSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <Skeleton className="mx-auto h-4 w-24" />
      {(["w-3/5", "w-2/5", "w-1/2", "w-1/3"] as const).map((w, i) => (
        <div key={i} className={cn("flex flex-col gap-2", i % 2 ? "items-end" : "items-start")}>
          <Skeleton className={cn("h-14 rounded-lg", w)} />
          <Skeleton className="mx-3 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

/** The conversation layout, header, bubbles and reply box, while it loads. */
export function ConversationSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy aria-label="Loading Conversation">
      <div className="flex shrink-0 items-center gap-3 border-b p-3 md:px-4">
        <Skeleton className="size-8 rounded-full" />
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="ml-auto size-9 rounded-md" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3 md:px-4">
        <div className="mx-auto w-full max-w-2xl"><BubblesSkeleton /></div>
      </div>
      <div className="shrink-0 border-t p-3 md:px-4">
        <div className="mx-auto w-full max-w-2xl rounded-lg border p-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-4 h-5 w-full" />
          <div className="mt-6 flex items-center justify-between">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Adjust changes the text in the reply box (yours or a draft you changed), keeping what it says.
const TONES: { key: Draft["tone"]; label: string }[] = [
  { key: "shorter", label: "Shorter" },
  { key: "formal", label: "More Formal" },
  { key: "casual", label: "More Casual" },
];

// For as long as the app is open: what you typed in each conversation, so leaving it and coming back
// keeps it; and what the reply box held when you last asked the AI for something there, for Undo.
const typedText = new Map<string, string>();
const beforeAsk = new Map<string, { text: string; replacing?: string }>();
// Whose they are: another person signing in on this tab starts with neither.
let remembersFor: string | null | undefined;

function Composer({ thread, msgs, phase, onDraft, onDiscardDraft, onSend }: { thread: Thread; msgs: Message[]; phase?: DraftPhase; onDraft: (tone?: Draft["tone"], instruction?: string, decision?: Decision, source?: string, audio?: Blob) => void; onDiscardDraft: () => void; onSend: (body: string, from?: string, files?: OutboxUpload[], copies?: { to: string[]; cc: string[] }) => Promise<boolean> }) {
  const replyFrom = useReplyFrom(thread, msgs);
  const replyAll = useReplyAll(thread, msgs, replyFrom);
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState("");
  const draft = thread.draft;
  const busy = !!phase;
  const ref = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef(thread.id);
  threadRef.current = thread.id;
  // Undo puts back what the box held once the draft is gone, instead of the empty box a discard leaves.
  const restoreRef = useRef<string | undefined>(undefined);
  // Your own text (or a draft you changed) can be lightly corrected by the AI without being rewritten.
  const editable = !busy && text.trim().length > 0 && text.trim() !== (draft?.body ?? "").trim();
  // Undo is offered for a draft you asked for over text that was there, until you change the draft.
  const before = beforeAsk.get(thread.id);
  const undoable = !busy && !!draft && !draft.auto && !!before && draft.id !== before.replacing && text === draft.body;

  // What the box last showed for this conversation and from which draft, so a pre-draft arriving while
  // you type is held back, and a run with nothing new (React runs it twice on mount in development)
  // leaves the box alone.
  const shownRef = useRef({ thread: "", text: "", draft: "", body: "" });
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    const same = shownRef.current.thread === thread.id;
    if (same && restoreRef.current === undefined && shownRef.current.draft === (draft?.id ?? "") && shownRef.current.body === (draft?.body ?? "")) return;
    const typing = same && textRef.current.trim() !== "" && textRef.current !== shownRef.current.text;
    if (draft?.auto && typing) return;
    // Back in a conversation, what you were typing there comes back instead of its draft. It still
    // counts as typing, so a pre-draft arriving does not replace it.
    const kept = same ? undefined : typedText.get(thread.id);
    const next = kept ?? restoreRef.current ?? draft?.body ?? "";
    restoreRef.current = undefined;
    shownRef.current = { thread: thread.id, text: kept === undefined ? next : draft?.body ?? "", draft: draft?.id ?? "", body: draft?.body ?? "" };
    setText(next);
  }, [thread.id, draft?.id, draft?.body, draft?.auto]);
  // What you asked for stays in the box with its draft, so another try or an adjustment keeps it.
  // A pre-draft has none, and arriving it leaves what you are typing there alone.
  const askedIn = useRef("");
  useEffect(() => {
    if (draft?.auto && askedIn.current === thread.id) return;
    askedIn.current = thread.id;
    setInstruction(draft?.instruction ?? "");
  }, [thread.id, draft?.id, draft?.instruction, draft?.auto]);
  const type = (value: string) => {
    setText(value);
    if (value.trim() && value !== (draft?.body ?? "")) typedText.set(thread.id, value);
    else typedText.delete(thread.id);
  };
  // Every request goes through here, so what the box held can come back with Undo.
  const ask = (tone?: Draft["tone"], said?: string, decision?: Decision, source?: string, audio?: Blob) => {
    if (text.trim()) beforeAsk.set(thread.id, { text, replacing: draft?.id });
    else beforeAsk.delete(thread.id);
    typedText.delete(thread.id);
    onDraft(tone, said, decision, source, audio);
  };
  const undo = () => {
    if (!before) return;
    beforeAsk.delete(thread.id);
    restoreRef.current = before.text;
    typedText.set(thread.id, before.text);
    onDiscardDraft();
  };
  const said = instruction.trim();
  // Draft and Edit Text each ask what you want first, in a dialog, so it is clear what they will do.
  const [asking, setAsking] = useState<"draft" | "edit" | null>(null);
  const [change, setChange] = useState("");
  const draftLabel = draft ? "Redraft" : thread.lastFromMe ? "Draft Follow-Up" : "Draft";
  const startDraft = () => {
    setAsking(null);
    ask(said ? "custom" : "default", said || undefined, draft?.decision);
  };
  const startEdit = () => {
    const note = change.trim();
    setAsking(null);
    setChange("");
    ask("edit", note || undefined, undefined, text);
  };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "0px"; el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [text]);

  const [sending, setSending] = useState(false);
  // Files go up first, then the reply is queued with them. A failure keeps the text and the files.
  const files = useOutboxFiles(attachProvider(thread.provider), busy || sending);
  const clearFiles = files.clear;
  useEffect(() => { clearFiles(); }, [thread.id, clearFiles]);
  const voice = useVoiceRecorder(files, thread.id);
  // Speak: what you say becomes the draft's instruction. The newest ask() is used when the clip is done.
  const askRef = useRef(ask);
  askRef.current = ask;
  const speech = useVoiceRecorder(files, thread.id, (clip) => askRef.current("custom", undefined, thread.draft?.decision, undefined, clip));
  const recorder = voice.recording ? voice : speech.recording ? speech : undefined;
  const closed = useInstagramReplyClosed(thread, msgs);
  const canSend = (text.trim().length > 0 || files.items.length > 0) && !busy && !sending && !files.blocked && !replyAll.error && !recorder && !closed;
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    const sentFrom = thread.id;
    let queued = false;
    try {
      const uploaded = await files.upload();
      if (!uploaded) return;
      queued = await onSend(text, replyFrom.chosen ?? undefined, uploaded, replyAll.copies);
    } catch {
      toast("Could not send. Your reply is still in the box.");
    } finally {
      setSending(false);
    }
    if (!queued) return;
    typedText.delete(sentFrom);
    beforeAsk.delete(sentFrom);
    // Only the box that sent is cleared: you may have moved to another conversation meanwhile.
    if (threadRef.current === sentFrom) { setText(""); setInstruction(""); files.clear(); replyAll.reset(); }
  };

  return (
    <div className="shrink-0 border-t bg-background p-3 md:px-4">
      <div className="mx-auto w-full max-w-2xl">
        {closed && <InstagramReplyNotice />}
        {!draft && !busy && <GuidedChoices thread={thread} msgs={msgs} disabled={busy} onPick={(decision) => ask("default", undefined, decision)} />}
        {!recorder && (
          // Each button says what it will do in a tooltip, and Draft and Edit Text ask what you want in a dialog first.
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Hint text={draft ? "Writes a new version of this draft that replaces it. Undo brings the old one back." : thread.lastFromMe ? "Writes a follow-up to the message you sent last, in your voice. Nothing is sent." : "Writes a reply in your voice from this conversation. You choose what it should say first. Nothing is sent."}>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setAsking("draft")}>{draftLabel}</Button>
            </Hint>
            {editable && (
              <Hint text="Fixes spelling and wording in what you wrote, or changes it the way you ask, keeping your meaning. Nothing is sent.">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setAsking("edit")}>Edit Text</Button>
              </Hint>
            )}
            {text.trim() && (
              <DropdownMenu>
                <Hint text="Rewrites your text to be shorter, more formal or more casual.">
                  <DropdownMenuTrigger asChild><Button type="button" variant="secondary" disabled={busy}>Adjust <ChevronDown /></Button></DropdownMenuTrigger>
                </Hint>
                <DropdownMenuContent align="start">
                  {TONES.map((t) => (
                    <DropdownMenuItem key={t.key} onSelect={() => ask(t.key, said || undefined, draft?.decision, text)}>{t.label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {undoable && <Hint text="Puts back what was in the box before the last draft."><Button type="button" variant="secondary" onClick={undo}>Undo</Button></Hint>}
            {draft && <Hint text="Removes this draft and empties the box."><Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Discard Draft" disabled={busy} onClick={() => { beforeAsk.delete(thread.id); typedText.delete(thread.id); onDiscardDraft(); setText(""); }}><X /></Button></Hint>}
          </div>
        )}
        {/* While a draft is written the text box becomes a placeholder line. */}
        <div {...files.dropProps} className={cn("rounded-lg border bg-background/50 p-3 focus-within:ring-3 focus-within:ring-ring/30", files.dragging && "border-ring ring-3 ring-ring/30")}>
          <ReplyHeader thread={thread} msgs={msgs} reply={replyFrom} all={replyAll} />
          {recorder ? (
            <RecordingStatus voice={recorder} />
          ) : phase === "thinking" ? (
            // One line, the height of the empty text box, so the composer does not jump in size.
            <div className="flex h-5 items-center" aria-label="Drafting a reply">
              <Skeleton className="h-3 w-3/5" />
            </div>
          ) : (
            <Textarea
              ref={ref}
              value={text}
              readOnly={phase === "streaming"}
              onChange={(e) => type(e.target.value)}
              onPaste={files.onPaste}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
              placeholder="Message"
              rows={1}
              className="min-h-5 resize-none rounded-none border-0 bg-transparent p-0 text-base leading-5 md:text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          )}
          <div className="mt-3 empty:hidden"><AttachmentChips files={files} /></div>
          <div className="mt-6 flex items-center justify-between gap-3">
            {recorder ? <div /> : (
              <div className="flex items-center gap-2">
                <AttachButton files={files} />
                <RecordButton files={files} voice={voice} />
                <TemplatePicker workspaceId={thread.workspaceId} disabled={busy} onInsert={(t) => type(text.trim() ? `${text.trimEnd()}\n\n${t}` : t)} />
              </div>
            )}
            {recorder
              ? <RecordingActions voice={recorder} done={recorder === speech ? "Draft" : "Stop"} />
              : <Button disabled={!canSend} onClick={submit}>Send via {providerLabel[thread.provider]}</Button>}
          </div>
        </div>
      </div>
      <Dialog open={asking === "draft"} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent showCloseButton={false} track="draft_reply" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draftLabel}</DialogTitle>
            <DialogDescription>
              {draft
                ? "Say what to change, or leave it empty to try again. The new version replaces this draft."
                : "Say what the reply should cover, or leave it empty and Konva writes it from the conversation. Nothing is sent until you press Send."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startDraft(); } }}
            placeholder="For example: say yes and suggest Thursday"
            aria-label="What To Say"
            className="resize-none"
          />
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="secondary" onClick={() => { setAsking(null); speech.start(); }}>Record Instead</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={startDraft}>{draftLabel}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={asking === "edit"} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent showCloseButton={false} track="edit_text" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Text</DialogTitle>
            <DialogDescription>Say what to change in your text, or leave it empty to fix spelling and wording only. Your meaning stays the same and nothing is sent.</DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={change}
            onChange={(e) => setChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startEdit(); } }}
            placeholder="For example: make it friendlier and mention the invoice"
            aria-label="What To Change"
            className="resize-none"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={startEdit}>Edit Text</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A tooltip for a control, saying what it does. */
function Hint({ text, children }: { text: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-64 text-balance">{text}</TooltipContent>
    </Tooltip>
  );
}
