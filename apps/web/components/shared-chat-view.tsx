"use client";

// One shared chat, open for reading by someone who is not its agent (step 5 of Teams): an assignee, a member of the shared
// inbox it is in, an owner or admin it is assigned to, or Compliance. The messages are read-only. An assignee answers from
// their own account, a member of the inbox from the inbox. Notes between colleagues sit in a panel and are never sent.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, NotebookPen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { dayLabel, fullStamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { clientAddress, outboxState, sendInboxReply, sendOwnReply, useMyReplies, useNotes, useReplyingPresence, useSharedChat, type SharedChatInfo, type TimelineMessage } from "@/lib/shared-chat";
import { supabase } from "@/lib/supabase";
import { pollWhileVisible } from "@/lib/visible-poll";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/primitives";
import { isNearBottom } from "@/components/near-bottom";
import { MessageBody } from "@/components/message-body";
import { TemplatePicker } from "@/components/template-picker";
import { AssignmentNotices } from "@/components/assignment-notices";

const CHANNEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram", teams: "Teams", zoom: "Zoom", google_chat: "Google Chat" };
const EMAIL_PROVIDERS = ["icloud", "gmail", "outlook", "imap"];
const POLL_MS = 3000;

const ACCESS_LINE: Record<SharedChatInfo["access"], string> = {
  agent: "This is your chat.",
  assignee: "This chat is assigned to you. You can read it and answer from your own account.",
  cover: "You are covering this chat while its agent is away. You can read it and answer from your own account, never from theirs.",
  inbox: "You can read and answer this chat because you use this shared inbox.",
  compliance: "You are reading this as Compliance. Opening it has been logged, and the agent can see that you did. Compliance reads and never replies.",
};

/** A message as a bubble: the client's on the left, the team's on the right, your own account's marked as yours. */
const SharedBubble = memo(function SharedBubble({ m, client, whatsapp, showMeta }: { m: TimelineMessage; client: string; whatsapp: boolean; showMeta: boolean }) {
  const me = m.from === "me";
  const body = m.body.trim();
  return (
    <div className={cn("flex flex-col gap-2", me ? "items-end" : "items-start")}>
      {(body || m.quoted || !m.attachments?.length) && (
        <div className="flex max-w-[92%] items-center gap-1 md:max-w-[80%]">
          <div className={cn("min-w-0 rounded-lg p-3 text-sm leading-6", me ? "rounded-br-[2px] bg-primary text-primary-foreground" : "rounded-bl-[2px] bg-muted")}>
            {m.deleted ? <p className="opacity-70">{m.body}</p> : <MessageBody m={m} whatsapp={whatsapp && !!m.whatsapp} bulk={!!m.bulk} noRead />}
          </div>
        </div>
      )}
      {m.attachments && m.attachments.length > 0 && (
        <div className={cn("flex max-w-[92%] flex-wrap gap-1 text-xs md:max-w-[80%] text-muted-foreground", me && "justify-end")}>
          {m.attachments.map((a) => <Badge key={a.id} variant="outline">{a.name || "File"}</Badge>)}
        </div>
      )}
      {showMeta && (
        <div className="px-3 text-xs text-muted-foreground">
          {[me ? (m.own ? "You, from your own account" : "Sent by the team") : client, fullStamp(m.sentAt)].join(" · ")}
        </div>
      )}
    </div>
  );
});

function Timeline({ messages, client, whatsapp }: { messages: TimelineMessage[]; client: string; whatsapp: boolean }) {
  const groups = useMemo(() => {
    const now = new Date();
    const out: { key: string; day: string; items: TimelineMessage[] }[] = [];
    for (const m of messages) {
      const key = new Date(m.sentAt).toDateString();
      const g = out[out.length - 1];
      if (g?.key === key) g.items.push(m);
      else out.push({ key, day: dayLabel(m.sentAt, now), items: [m] });
    }
    return out;
  }, [messages]);
  return (
    <div className="space-y-6" role="log" aria-live="polite" aria-label="Messages">
      {groups.map((g) => (
        <div key={g.key} className="space-y-6">
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">{g.day}</span>
            <Separator className="flex-1" />
          </div>
          <div className="flex flex-col gap-2">
            {g.items.map((m, i) => {
              const next = g.items[i + 1];
              return <SharedBubble key={`${m.own ? "own" : "shared"}-${m.id}`} m={m} client={client} whatsapp={whatsapp} showMeta={!next || next.from !== m.from || !!next.own !== !!m.own} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Follows a queued reply until it is sent or has failed. */
function useQueued(onSent: () => void) {
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const sentRef = useRef(onSent);
  sentRef.current = onSent;
  useEffect(() => {
    if (!id || state !== "sending") return;
    let alive = true;
    const stop = pollWhileVisible(async () => {
      const s = await outboxState(id);
      if (!alive) return;
      if (s.status === "sent") { setState("sent"); sentRef.current(); }
      if (s.status === "failed") { setState("failed"); setError(s.error ?? "It could not be sent."); }
    }, POLL_MS);
    return () => { alive = false; stop(); };
  }, [id, state]);
  return { state, error, start: (next: string) => { setId(next); setError(null); setState("sending"); }, reset: () => { setId(null); setState("idle"); setError(null); } };
}

/** A reply in a shared inbox's chat, sent from the shared account. */
function InboxReply({ info, presence, onSent }: { info: SharedChatInfo; presence: ReturnType<typeof useReplyingPresence>; onSent: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const queued = useQueued(onSent);
  const locked = busy || queued.state === "sending";
  const send = async () => {
    if (!body.trim() || locked) return;
    setBusy(true);
    presence.setTyping(false);
    let out: Awaited<ReturnType<typeof sendInboxReply>>;
    try {
      out = await sendInboxReply(info.threadId, body.trim());
    } catch {
      return void toast.error("Could not send. Your reply is still in the box.");
    } finally {
      setBusy(false);
    }
    if ("problem" in out) return void toast.error(out.problem);
    setBody("");
    queued.start(out.id);
  };
  return (
    <div className="space-y-2">
      {presence.others.length > 0 && (
        <p className="text-xs text-muted-foreground" role="status">
          {presence.others.length === 1 ? `${presence.others[0]} is replying` : `${presence.others.join(" and ")} are replying`}
        </p>
      )}
      <Textarea
        rows={3}
        value={body}
        disabled={locked}
        placeholder={`Reply from ${info.inboxName ?? "the shared inbox"}`}
        aria-label="Reply"
        onChange={(e) => { setBody(e.target.value); presence.setTyping(e.target.value.length > 0); }}
        onBlur={() => presence.setTyping(false)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {queued.state === "sent" ? "Sent from the shared inbox." : queued.state === "failed" ? <span className="text-destructive">{queued.error}</span> : `Goes from ${info.inboxName ?? "the shared account"}, not from your own account.`}
        </p>
        <div className="flex items-center gap-1"><TemplatePicker workspaceId={info.workspaceId} disabled={locked} onInsert={(t) => setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${t}` : t))} /><Button disabled={locked || !body.trim()} onClick={() => void send()}>{locked ? "Sending" : "Send"}</Button></div>
      </div>
    </div>
  );
}

/** A reply from your own account to the same client: a new conversation on your account, linked to this chat. */
function OwnReply({ info, messages, onSent }: { info: SharedChatInfo; messages: TimelineMessage[]; onSent: () => void }) {
  const { accounts } = useApp();
  const { replies, reload } = useMyReplies(info.threadId, true);
  const channel = info.channel === "whatsapp" ? "whatsapp" : info.channel === "email" ? "email" : null;
  const usable = useMemo(
    () => accounts.filter((a) => a.status !== "disconnected" && (channel === "whatsapp" ? a.provider === "whatsapp" : EMAIL_PROVIDERS.includes(a.provider))),
    [accounts, channel],
  );
  const to = useMemo(() => (channel ? clientAddress(messages.filter((m) => !m.own), channel) : null), [messages, channel]);
  const [accountId, setAccountId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const queued = useQueued(() => { onSent(); void reload(); });
  const account = usable.find((a) => a.id === accountId) ?? usable[0];
  const locked = busy || queued.state === "sending";
  const defaultSubject = useMemo(() => (info.subject ? (/^re:/i.test(info.subject) ? info.subject : `Re: ${info.subject}`) : ""), [info.subject]);
  const mineLinked = replies.find((r) => r.threadId);

  const send = async () => {
    if (!account || !to || !channel || !body.trim() || locked) return;
    setBusy(true);
    let out: Awaited<ReturnType<typeof sendOwnReply>>;
    try {
      out = await sendOwnReply({ threadId: info.threadId, accountId: account.id, channel, to, subject: subject || defaultSubject, body: body.trim() });
    } catch {
      return void toast.error("Could not send. Your reply is still in the box.");
    } finally {
      setBusy(false);
    }
    if ("problem" in out) return void toast.error(out.problem);
    setBody("");
    queued.start(out.id);
  };

  if (info.isGroup) return <p className="text-sm text-muted-foreground">This is a group chat. A group cannot be answered from your own account.</p>;
  if (!channel) return <p className="text-sm text-muted-foreground">Replying from your own account is only built for email and WhatsApp chats so far.</p>;
  if (usable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect your own {channel === "whatsapp" ? "WhatsApp" : "email"} account to answer this client. <Link href="/settings/accounts" className="underline underline-offset-4">Connected Accounts</Link>
      </p>
    );
  }
  if (!to) {
    return <p className="text-sm text-muted-foreground">{channel === "whatsapp" ? "WhatsApp has hidden this person's number, so there is nothing to write to from your account." : "There is no address in this chat to write to."}</p>;
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="own-from">From Your Account</Label>
          <Select value={account?.id ?? ""} onValueChange={setAccountId} disabled={locked}>
            <SelectTrigger id="own-from" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{usable.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}{a.detail ? ` (${a.detail})` : ""}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="own-to">To</Label>
          <Input id="own-to" readOnly value={to} />
        </div>
      </div>
      {channel === "email" && (
        <div className="grid gap-1.5">
          <Label htmlFor="own-subject">Subject</Label>
          <Input id="own-subject" value={subject || defaultSubject} disabled={locked} onChange={(e) => setSubject(e.target.value)} />
        </div>
      )}
      <Textarea rows={4} value={body} disabled={locked} aria-label="Reply" placeholder="Write your reply" onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {queued.state === "sent" ? (mineLinked?.threadId ? <>Sent. <Link href={`/inbox/${mineLinked.threadId}`} className="underline underline-offset-4">Open Your Conversation</Link></> : "Sent. Your conversation appears here and in your Inbox once it is filed.")
            : queued.state === "failed" ? <span className="text-destructive">{queued.error}</span>
            : `Starts a new conversation on your account with the same client, linked to this chat. ${info.agentName}'s account is never used.`}
        </p>
        <div className="flex items-center gap-1"><TemplatePicker workspaceId={info.workspaceId} disabled={locked} onInsert={(t) => setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${t}` : t))} /><Button disabled={locked || !body.trim()} onClick={() => void send()}>{locked ? "Sending" : "Send"}</Button></div>
      </div>
    </div>
  );
}

/** The team's notes on this chat, in a panel. Internal: never sent to the client. */
function NotesPanel({ threadId, open, onOpenChange, canWrite, names }: { threadId: string; open: boolean; onOpenChange: (open: boolean) => void; canWrite: boolean; names: Map<string, string> }) {
  const { session } = useAuth();
  const me = session?.user.id;
  const { notes, add, remove } = useNotes(threadId, true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const problem = await add(text);
    setBusy(false);
    if (problem) return void toast.error(problem);
    setText("");
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Notes</SheetTitle>
          <SheetDescription>For your team only. Notes are never sent to the client, and only people who can read this chat can read them.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4">
          {notes.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <div className="space-y-4 py-2">
              {notes.map((n) => (
                <div key={n.id} className="space-y-1 rounded-lg bg-muted p-3 text-sm">
                  <p className="whitespace-pre-wrap wrap-anywhere">{n.text}</p>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{n.userId === me ? "You" : names.get(n.userId) ?? "Former Member"} · {fullStamp(n.createdAt)}</span>
                    {n.userId === me && (
                      <Button variant="ghost" size="icon-xs" aria-label="Delete Note" onClick={async () => { const p = await remove(n.id); if (p) toast.error(p); }}><Trash2 /></Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        {canWrite && (
          <div className="space-y-2 border-t p-4">
            <Textarea rows={3} value={text} maxLength={4000} aria-label="New Note" placeholder="Add a note for your team" disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }} />
            <div className="flex justify-end"><Button disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? "Adding" : "Add Note"}</Button></div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function SharedChatView({ threadId }: { threadId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { profile } = useApp();
  const { session } = useAuth();
  const me = session?.user.id;
  const { info, messages, older, failed, load, loadOlder } = useSharedChat(threadId);
  const [notesOpen, setNotesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const myName = profile.name || session?.user.email || "Someone";
  const presence = useReplyingPresence(threadId, info?.reply === "inbox", myName);
  const backHref = params.get("from") === "work" ? "/settings/team?view=work-chats" : "/inbox";
  const scrollRef = useRef<HTMLDivElement>(null);

  const names = useMemo(() => {
    const out = new Map<string, string>();
    for (const a of info?.assignees ?? []) out.set(a.userId, a.name);
    if (info) out.set(info.agentId, info.agentName);
    return out;
  }, [info]);

  // Newest at the bottom: scroll there when the first messages arrive and when one arrives while you are near it.
  const last = messages?.[messages.length - 1]?.id;
  const nearBottom = useRef(true);
  const shown = useRef<{ thread?: string; last?: string }>({});
  const ready = info !== undefined && messages !== null;
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (!el) return;
    const onScroll = () => { nearBottom.current = isNearBottom(el); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ready, info?.threadId]);
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]");
    const prev = shown.current;
    shown.current = { thread: info?.threadId, last };
    // Opening the chat, or its first messages arriving, goes to the bottom; a later message only when you are already there.
    const opening = prev.thread !== info?.threadId || prev.last === undefined;
    if (el && (opening || nearBottom.current)) el.scrollTo({ top: el.scrollHeight });
  }, [last, info?.threadId]);

  const assign = useCallback(async (assignee: string | null) => {
    setBusy(true);
    let error: { message?: string } | null;
    try {
      ({ error } = await supabase.rpc("assign_inbox_chat", { p_thread: threadId, p_assignee: assignee }));
    } catch {
      error = {};
    } finally {
      setBusy(false);
    }
    if (error) return void toast.error(error.message || "Could not change this. Try again.");
    void load();
  }, [threadId, load]);

  if (info === undefined || messages === null) {
    return failed ? (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">This chat did not load.</p>
        <Button variant="secondary" onClick={() => void load()}>Retry</Button>
      </div>
    ) : (
      <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading chat"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-16 w-2/3" /><Skeleton className="ml-auto h-16 w-1/2" /></div>
    );
  }
  if (info === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={NotebookPen}
          title="You Cannot Open This Chat"
          description="A work chat is read by its agent and whoever it is assigned to. An owner or admin opens one by assigning it to themselves first, in Settings, Team, Work Chats."
          action={<Button variant="secondary" onClick={() => router.push(backHref)}>Back</Button>}
        />
      </div>
    );
  }

  const mine = info.assignees.some((a) => a.userId === me);
  const inboxChat = info.sharedBy === "account";
  const title = info.label || "Chat";
  const writes = info.access !== "compliance";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b bg-background p-3 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back"><Link href={backHref}><ArrowLeft /></Link></Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{title}</span>
            <Badge variant="outline">{CHANNEL[info.channel] ?? info.channel}</Badge>
            <Badge variant="secondary">Work</Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {inboxChat ? `Shared inbox ${info.inboxName ?? ""}`.trim() : info.agentLeft ? `${info.agentName} has left the team` : `${info.agentName}'s chat`}
            {info.assignees.length ? `, assigned to ${info.assignees.map((a) => (a.userId === me ? "you" : a.name)).join(", ")}` : ", not assigned"}
          </div>
        </div>
        {inboxChat && info.access === "inbox" && (
          mine
            ? <Button variant="secondary" disabled={busy} onClick={() => void assign(null)}>Unassign</Button>
            : <Button variant="secondary" disabled={busy} onClick={() => me && void assign(me)}>Assign to Me</Button>
        )}
        <Button variant="secondary" onClick={() => setNotesOpen(true)}><NotebookPen /> Notes</Button>
      </header>
      <div className="shrink-0 border-b bg-muted/50 px-3 py-2 text-sm md:px-4">{ACCESS_LINE[info.access]}{info.access === "cover" && info.coverEnds ? ` Cover ends ${fullStamp(info.coverEnds)}.` : ""}</div>
      <AssignmentNotices threadId={threadId} />

      <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
        <div className="p-3 md:px-4">
          <div className="mx-auto w-full max-w-2xl space-y-4">
            {older && <div className="flex justify-center"><Button variant="secondary" onClick={() => void loadOlder()}>Load Earlier Messages</Button></div>}
            {messages.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Nothing has been shared in this chat yet. New messages appear here as the team&apos;s copy is made.</p>
            ) : (
              <Timeline messages={messages} client={title} whatsapp={info.channel === "whatsapp"} />
            )}
          </div>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t bg-background p-3 md:px-4">
        <div className="mx-auto w-full max-w-2xl">
          {info.reply === "inbox" ? (
            <InboxReply info={info} presence={presence} onSent={() => void load()} />
          ) : info.reply === "own" ? (
            <OwnReply info={info} messages={messages} onSent={() => void load()} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {info.access === "compliance" ? "Compliance reads work chats and never replies." : info.access === "agent" ? <>This is your own chat. <Link href={`/inbox/${info.threadId}`} className="underline underline-offset-4">Open it in your Inbox</Link> to reply.</> : "You cannot reply to this chat."}
            </p>
          )}
        </div>
      </div>
      <NotesPanel threadId={threadId} open={notesOpen} onOpenChange={setNotesOpen} canWrite={writes} names={names} />
    </div>
  );
}
