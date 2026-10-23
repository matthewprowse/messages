"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, ChevronDown, MoreHorizontal, SquarePen, X, Inbox, Paperclip } from "lucide-react";
import { useApp, type DraftPhase } from "@/lib/store";
import type { Attachment, Contact, Decision, Draft, FiledAttachment, Message, Thread } from "@/lib/types";
import { dayLabel, formatPhone, fullStamp, relTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ThreadAvatar, EmptyState, providerLabel } from "@/components/primitives";
import { AttachmentGrid, AttachmentTile, AttachmentViewer, StickerImage, isSticker } from "@/components/attachments";
import { MessageBody } from "@/components/message-body";
import { GuidedChoices } from "@/components/guided-choices";
import { BubbleActions, QuoteBlock, ReactionChips, useReactorName, type NameOf, type OnReact } from "@/components/message-extras";
import { ReplyHeader, useReplyFrom } from "@/components/reply-header";
import { AttachButton, AttachmentChips, useOutboxFiles } from "@/components/outbox-attachments";
import { isTypingKey } from "@/components/new-menu";
import { ComposeDialog } from "@/components/compose-dialog";
import { attachProvider, type OutboxUpload } from "@/lib/outbox-files";

/** basePath is where Back, Escape and archiving return: /inbox, or /briefing when opened from the Summary page. */
export function ThreadView({ threadId, basePath = "/inbox" }: { threadId: string; basePath?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const focusId = params.get("message");
  const listQuery = new URLSearchParams(params);
  listQuery.delete("message");
  const backHref = listQuery.size ? `${basePath}?${listQuery.toString()}` : basePath;
  const {
    threadById, contactById, contacts, messagesFor, messagesLoaded, loadMessages, loadOlderMessages, loading, markRead, archive, trash, pin, giveFeedback,
    send, generateDraft, discardDraft, setJunk, drafting, hydrated, setReplyTo, react,
  } = useApp();
  const thread = threadById(threadId);
  // The store keeps one list per conversation, which only changes when this conversation does.
  const msgs = messagesFor(threadId);
  const loaded = messagesLoaded(threadId);
  const phase = drafting[threadId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const threadExists = !!thread;
  const [filesOpen, setFilesOpen] = useState(false);
  // One viewer for the whole conversation, opened by any bubble's attachment.
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const files = useMemo(
    () => msgs.flatMap((m) => (m.attachments ?? []).map<FiledAttachment>((a) => ({ ...a, messageId: m.id, threadId: m.threadId, sentAt: m.sentAt, from: m.from }))).reverse(),
    [msgs],
  );
  const nameOf = useReactorName(contacts);
  const senderNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const m of msgs) if (m.from !== "me" && !out.has(m.from)) out.set(m.from, contactById(m.from)?.name ?? "Unknown");
    return out;
  }, [msgs, contactById]);
  const header = useMemo(() => (thread ? headerOf(thread, msgs, contactById) : null), [thread, msgs, contactById]);

  // Messages load when a conversation is opened, and then stay live.
  useEffect(() => {
    if (threadExists && !messagesLoaded(threadId)) loadMessages(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, threadExists]);

  useEffect(() => {
    if (!hydrated || !thread?.unread) return;
    const t = setTimeout(() => markRead(threadId, true, true), 600);
    return () => clearTimeout(t);
    // Re-checked once the conversation has loaded, for when it is opened straight from its address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, hydrated, threadExists]);

  // New messages at the bottom scroll it into view; older ones loaded at the top do not.
  const lastId = msgs[msgs.length - 1]?.id;
  useEffect(() => {
    const el = viewportOf(scrollRef.current);
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadId, lastId, phase]);

  // Scrolling near the top loads the page before, and keeps the message that was first in view where it
  // was. Measured from that message, so it holds whether or not the browser's own scroll anchoring acts.
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const firstId = msgs[0]?.id;
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
      if (!el || !first || el.scrollTop > 400 || anchor.current) return;
      anchor.current = { id: first.getAttribute("data-message-id")!, top: first.getBoundingClientRect().top };
      loadOlderMessages(threadId).then((added) => { if (!added) anchor.current = null; });
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      anchor.current = null;
    };
  }, [threadId, loaded, threadExists, loadOlderMessages]);

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
    router.replace(`${basePath}/${threadId}${listQuery.size ? `?${listQuery.toString()}` : ""}`, { scroll: false });
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
      if (e.key === "e") { archive(thread.id); router.push(backHref); }
      if (e.key === "u") { markRead(thread.id, false); router.push(backHref); }
      if ((e.key === "#" || e.key === "Delete") && !e.altKey) { trash(thread.id); router.push(backHref); }
      if (e.key === "!" && !e.altKey) { setJunk(thread.id, !thread.junk); router.push(backHref); }
      if (e.key === "Escape") router.push(backHref);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [thread, archive, trash, setJunk, markRead, router, backHref]);

  if (!thread || !header) {
    if (loading) return <ConversationSkeleton />;
    return <EmptyState icon={Inbox} title="Conversation Not Found" description="It may have been archived or deleted." action={<Button variant="outline" asChild><Link href={basePath}>{basePath === "/inbox" ? "Back to Conversations" : "Go Back"}</Link></Button>} />;
  }
  const { primary, title, subtitle } = header;

  return (
    // A solid header and composer, each set off by a line, with only the messages scrolling between them,
    // like the Conversations list.
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b bg-background p-3 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back">
          <Link href={backHref}><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          {/* Hovering the avatar or name slides a View button out from behind the name. */}
          <div className="group/name flex w-fit max-w-full min-w-0 items-center gap-3">
            <ThreadAvatar thread={thread} contacts={contactById} className="size-8" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{title}</div>
              {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
            </div>
            {primary && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="pointer-events-none h-8 shrink-0 -translate-x-2 opacity-0 transition-all duration-200 ease-out group-hover/name:pointer-events-auto group-hover/name:translate-x-0 group-hover/name:opacity-100 focus-visible:pointer-events-auto focus-visible:translate-x-0 focus-visible:opacity-100"
              >
                <Link href={`/contacts/${primary.id}`}>View</Link>
              </Button>
            )}
          </div>
        </div>
        <ChannelTabs thread={thread} person={primary} hrefFor={(id) => (listQuery.size ? `${basePath}/${id}?${listQuery.toString()}` : `${basePath}/${id}`)} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="secondary" size="icon" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max">
            <DropdownMenuItem onClick={() => pin(thread.id, !thread.pinned)}>{thread.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { archive(thread.id); router.push(backHref); }}>Archive</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { trash(thread.id); router.push(backHref); }}>Delete</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilesOpen(true)}>Attachments</DropdownMenuItem>
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

      {/* Padding sits outside the 672px column, as in the composer, so bubbles line up with the message box. */}
      <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
        <div className="p-3 md:px-4">
          <div className="mx-auto w-full max-w-2xl">
            {!loaded && msgs.length === 0 ? (
              <BubblesSkeleton />
            ) : (
              <Messages
                msgs={msgs}
                isGroup={!!thread.isGroup}
                whatsapp={thread.channel === "whatsapp"}
                flashId={flashId}
                senderNames={senderNames}
                nameOf={nameOf}
                onJump={onJump}
                onReply={onReply}
                onReact={react}
                onOpen={setViewing}
              />
            )}
          </div>
        </div>
      </ScrollArea>

      <Composer
        thread={thread}
        phase={phase}
        onDraft={(tone, instruction, decision) => generateDraft(thread.id, tone, instruction, decision)}
        onDiscardDraft={() => discardDraft(thread.id)}
        msgs={msgs}
        onSend={(body, from, files) => send(thread.id, body, from, files)}
      />

      <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />

      <Sheet open={filesOpen} onOpenChange={setFilesOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Attachments</SheetTitle>
            <SheetDescription>{files.length === 1 ? "1 file" : `${files.length} files`} in this conversation</SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
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
                className="p-4 pt-0"
              />
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
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
              Email<ChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {emails.slice(0, 8).map((t) => (
              <DropdownMenuItem key={t.id} asChild>
                <Link href={hrefFor(t.id)} aria-current={t.id === thread.id ? "page" : undefined}>
                  <Check className={t.id === thread.id ? undefined : "invisible"} />
                  <span className="min-w-0 flex-1 truncate">{t.subject?.trim() || "No Subject"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relTime(t.lastMessageAt)}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            {emails.length > 0 && address && <DropdownMenuSeparator />}
            {address && <DropdownMenuItem onSelect={() => setComposing(true)}><SquarePen />New Email</DropdownMenuItem>}
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

function viewportOf(root: HTMLElement | null) {
  return root?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;
}

const phoneOf = (n: string | undefined) => (n ? formatPhone(n) : undefined);

/** The name, subtitle and contact shown at the top of a conversation. */
function headerOf(thread: Thread, msgs: Message[], contactById: (id: string) => Contact | undefined) {
  const primary = thread.isGroup ? undefined : contactById(thread.participantIds[0]);
  const title = thread.isGroup ? thread.groupName : primary?.name ?? thread.fallbackName ?? "Unknown";
  // Who you are really talking to: the address their latest message came from, or their number.
  let lastAddress: string | undefined;
  for (let i = msgs.length - 1; i >= 0 && !lastAddress; i--) if (msgs[i].from !== "me") lastAddress = msgs[i].address;
  const subtitle = thread.isGroup
    ? groupMembers(thread.participantIds, msgs, contactById)
    : thread.channel === "email"
      ? lastAddress ?? primary?.emails[0]
      : phoneOf(primary?.phones[0] ?? (lastAddress?.includes("@") ? undefined : lastAddress));
  return { primary, title, subtitle };
}

interface ListProps {
  msgs: Message[];
  isGroup: boolean;
  whatsapp: boolean;
  flashId: string | null;
  senderNames: Map<string, string>;
  nameOf: NameOf;
  onJump: (id: string) => void;
  onReply: (m: Message) => void;
  onReact: OnReact;
  onOpen: (a: Attachment) => void;
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
const Messages = memo(function Messages({ msgs, isGroup, whatsapp, flashId, senderNames, ...handlers }: ListProps) {
  // A WhatsApp quote names the quoted message by WhatsApp's own ID.
  const byProviderId = useMemo(() => new Map(msgs.flatMap((m) => (m.providerId ? [[m.providerId, m.id] as const] : []))), [msgs]);
  // Split each day into runs of consecutive messages from the same sender. The label is worked out once per day.
  const groups = useMemo(() => {
    const now = new Date();
    const out: { key: string; day: string; runs: Message[][] }[] = [];
    for (const m of msgs) {
      const key = new Date(m.sentAt).toDateString();
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, day: dayLabel(m.sentAt, now), runs: [] };
        out.push(g);
      }
      const run = g.runs[g.runs.length - 1];
      if (run && run[0].from === m.from) run.push(m);
      else g.runs.push([m]);
    }
    return out;
  }, [msgs]);
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.key} className="space-y-6">
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">{g.day}</span>
            <Separator className="flex-1" />
          </div>
          {g.runs.map((run) => {
            const items = whatsapp ? withAlbums(run) : run.map((m) => [m]);
            return (
              <div key={run[0].id} className="flex flex-col gap-2">
                {items.map((ms, i) => {
                  const m = ms[ms.length - 1];
                  const shared = {
                    showMeta: i === items.length - 1,
                    sender: isGroup && m.from !== "me" ? senderNames.get(m.from) : undefined,
                    whatsapp,
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

interface BubbleProps extends Pick<ListProps, "whatsapp" | "nameOf" | "onJump" | "onReply" | "onReact" | "onOpen"> {
  m: Message;
  showMeta: boolean;
  /** The sender's name, shown in groups. */
  sender?: string;
  flash: boolean;
  quotedId?: string;
}

// Memoised with stable props, so a new message or a reaction redraws only the bubbles it changes.
const Bubble = memo(function Bubble({ m, showMeta, sender, whatsapp, flash, quotedId, nameOf, onJump, onReply, onReact, onOpen }: BubbleProps) {
  const me = m.from === "me";
  const bulk = !!m.bulk;
  // A sticker, photo or file sent with no words shows on its own, without an empty bubble.
  const showBubble = !!(m.body.trim() || m.quoted || m.quote || !m.attachments?.length);
  // Replies and reactions need a stored message: not one still sending, and not one its sender deleted.
  const actions = !m.sendState && !m.deleted ? <BubbleActions m={m} canReact={whatsapp} onReply={onReply} onReact={onReact} /> : null;
  return (
    <div data-message-id={m.id} className={cn("group/bubble flex flex-col gap-2", me ? "items-end" : "items-start")}>
      {m.attachments && m.attachments.length > 0 && (
        <div className={cn("flex max-w-full items-center gap-1", me && "flex-row-reverse")}>
          <div className={cn("flex flex-wrap gap-2", me && "justify-end")}>
            {m.attachments.map((a) =>
              isSticker(a) && a.path
                ? <StickerImage key={a.id} attachment={a} onOpen={() => onOpen(a)} />
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
            {m.deleted ? <p className="italic opacity-70">{m.body}</p> : <MessageBody m={m} whatsapp={whatsapp} bulk={bulk} />}
          </div>
          {actions}
        </div>
      )}
      <ReactionChips m={m} me={me} nameOf={nameOf} onReact={onReact} />
      {m.sendState === "failed" ? (
        <div className="px-3 text-xs text-destructive">{m.sendError ?? "Not Sent"}</div>
      ) : m.sendState === "sending" ? (
        <div className="px-3 text-xs text-muted-foreground">Sending</div>
      ) : (
        (showMeta || m.edited) && (
          <div className="px-3 text-xs text-muted-foreground">
            {showMeta ? (sender ? `${sender} · ${fullStamp(m.sentAt)}` : fullStamp(m.sentAt)) : ""}
            {m.edited ? (showMeta ? " · Edited" : "Edited") : ""}
          </div>
        )
      )}
    </div>
  );
});

/**
 * Photos sent together, as WhatsApp shows them: one grid, two to a row. Each photo keeps its own reactions;
 * Reply and React act on the last one, and the time is the last one's.
 */
const ImageAlbum = memo(function ImageAlbum({ ms, showMeta, sender, whatsapp, flash, nameOf, onReply, onReact, onOpen }: Omit<BubbleProps, "m" | "quotedId" | "onJump"> & { ms: Message[] }) {
  const last = ms[ms.length - 1];
  const me = last.from === "me";
  return (
    <div data-message-id={last.id} className={cn("group/bubble flex flex-col gap-2", me ? "items-end" : "items-start")}>
      <div className={cn("flex max-w-full items-center gap-1", me && "flex-row-reverse")}>
        <div className={cn("grid grid-cols-2 gap-2 rounded-lg ring-ring/50 transition-shadow duration-500", flash && "ring-2")}>
          {ms.flatMap((m) => m.attachments!.map((a) => (
            <AttachmentTile key={a.id} attachment={a} onOpen={() => onOpen(a)} showName={false} />
          )))}
        </div>
        <BubbleActions m={last} canReact={whatsapp} onReply={onReply} onReact={onReact} />
      </div>
      {ms.map((m) => <ReactionChips key={m.id} m={m} me={me} nameOf={nameOf} onReact={onReact} />)}
      {showMeta && (
        <div className="px-3 text-xs text-muted-foreground">{sender ? `${sender} · ${fullStamp(last.sentAt)}` : fullStamp(last.sentAt)}</div>
      )}
    </div>
  );
});

/** "Sarah, Tom and 4 others": the people in a group, from its members and everyone who has written in it. */
function groupMembers(participantIds: string[], msgs: Message[], contactById: (id: string) => { name: string } | undefined) {
  const ids = new Set(participantIds);
  for (const m of msgs) if (m.from !== "me" && m.from !== "unknown") ids.add(m.from);
  const names = [...ids].map((id) => contactById(id)?.name?.trim()).filter((n): n is string => !!n);
  if (names.length === 0) return undefined;
  const shown = names.slice(0, 3);
  const others = names.length - shown.length;
  if (others > 0) return `${shown.join(", ")} and ${others} ${others === 1 ? "other" : "others"}`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0];
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

const TONES: { key: Draft["tone"]; label: string }[] = [
  { key: "shorter", label: "Shorter" },
  { key: "formal", label: "More Formal" },
  { key: "casual", label: "More Casual" },
];

function Composer({ thread, msgs, phase, onDraft, onDiscardDraft, onSend }: { thread: Thread; msgs: Message[]; phase?: DraftPhase; onDraft: (tone?: Draft["tone"], instruction?: string, decision?: Decision) => void; onDiscardDraft: () => void; onSend: (body: string, from?: string, files?: OutboxUpload[]) => Promise<boolean> }) {
  const replyFrom = useReplyFrom(thread, msgs);
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [showInstruction, setShowInstruction] = useState(false);
  const draft = thread.draft;
  const busy = !!phase;
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setText(draft?.body ?? ""); }, [thread.id, draft?.id, draft?.body]);
  useEffect(() => { setInstruction(""); setShowInstruction(false); }, [thread.id, draft?.id]);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "0px"; el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [text]);

  const [sending, setSending] = useState(false);
  // Files go up first, then the reply is queued with them. A failure keeps the text and the files.
  const files = useOutboxFiles(attachProvider(thread.provider), busy || sending);
  const clearFiles = files.clear;
  useEffect(() => { clearFiles(); }, [thread.id, clearFiles]);
  const canSend = (text.trim().length > 0 || files.items.length > 0) && !busy && !sending && !files.blocked;
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    const uploaded = await files.upload();
    if (!uploaded) { setSending(false); return; }
    const queued = await onSend(text, replyFrom.chosen ?? undefined, uploaded);
    setSending(false);
    if (queued) { setText(""); files.clear(); }
  };

  return (
    <div className="shrink-0 border-t bg-background p-3 md:px-4">
      <div className="mx-auto w-full max-w-2xl">
        {draft && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {TONES.map((t) => (
              <Button key={t.key} variant={draft.tone === t.key ? "secondary" : "outline"} disabled={busy} onClick={() => onDraft(t.key, undefined, draft.decision)}>{t.label}</Button>
            ))}
            <Button variant={showInstruction ? "secondary" : "outline"} disabled={busy} onClick={() => setShowInstruction(!showInstruction)}>Instruct</Button>
            <Button variant="ghost" disabled={busy} onClick={() => onDraft(draft.tone, draft.instruction, draft.decision)}>Regenerate</Button>
            <Button variant="ghost" size="icon" className="ml-auto size-8" aria-label="Discard Draft" disabled={busy} onClick={() => { onDiscardDraft(); setText(""); }}><X /></Button>
          </div>
        )}
        {!draft && !busy && <GuidedChoices thread={thread} msgs={msgs} disabled={busy} onPick={(decision) => onDraft("default", undefined, decision)} />}
        {showInstruction && !busy && (
          <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) onDraft("custom", instruction, draft?.decision); }}>
            <Input autoFocus value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Custom Response Prompt" className="h-8" />
            <Button type="submit" variant="secondary" disabled={!instruction.trim()}>Redraft</Button>
          </form>
        )}
        {/* While a draft is written the text box becomes a placeholder line. */}
        <div {...files.dropProps} className={cn("rounded-lg border bg-background/50 p-3 focus-within:ring-3 focus-within:ring-ring/30", files.dragging && "border-ring ring-3 ring-ring/30")}>
          <ReplyHeader thread={thread} msgs={msgs} reply={replyFrom} />
          {phase === "thinking" ? (
            // One line, the height of the empty text box, so the composer does not jump in size.
            <div className="flex h-5 items-center" aria-label="Drafting a reply">
              <Skeleton className="h-3 w-3/5" />
            </div>
          ) : (
            <Textarea
              ref={ref}
              value={text}
              readOnly={phase === "streaming"}
              onChange={(e) => setText(e.target.value)}
              onPaste={files.onPaste}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
              placeholder="Message"
              rows={1}
              className="min-h-5 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          )}
          <div className="mt-3 empty:hidden"><AttachmentChips files={files} /></div>
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AttachButton files={files} />
              {!draft && !busy && (
                <Button variant="secondary" onClick={() => onDraft()}>Draft Reply</Button>
              )}
            </div>
            <Button disabled={!canSend} onClick={submit}>Send via {providerLabel[thread.provider]}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
