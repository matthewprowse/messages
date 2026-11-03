"use client";

// The From, To and Cc rows above the reply box, and the state behind them (which address sends, Reply versus Reply All).

import { Fragment, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Message, Thread } from "@/lib/types";
import { MAX_RECIPIENTS, defaultFrom, parseAddresses, replyAllRecipients, replyRecipients, sendAddressesOf } from "@/lib/send-from";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/format";
import { useAccountComposer } from "@/lib/use-account-composer";
import { WritingAsChip } from "@/components/writing-as-chip";

export interface ReplyFrom {
  options: string[];
  /** The From address shown, or "" when the account is unknown and the worker picks. */
  from: string;
  /** Set only when you picked one. Otherwise the worker applies the same default from the stored mail. */
  chosen: string | null;
  /** What to send as the From: your pick, else the Settings default when it changes what the worker would pick, else null. */
  explicit: string | null;
  setFrom: (address: string) => void;
}

/** The From address for a reply: picked by you, else the address the latest email was sent to. */
export function useReplyFrom(thread: Thread, msgs: Message[]): ReplyFrom {
  const { accounts } = useApp();
  const account = thread.channel === "email" ? accounts.find((a) => a.id === thread.accountId) : undefined;
  const options = useMemo(() => (account ? sendAddressesOf(account) : []), [account]);
  // The default set for the account in Settings decides only when no email does.
  const preferred = useAccountComposer().of(account?.id).defaultFrom;
  const fallback = useMemo(() => (account ? defaultFrom(account, msgs, preferred) : ""), [account, msgs, preferred]);
  // Kept per conversation, so a pick does not follow you into the next one.
  const [picked, setPicked] = useState<{ threadId: string; address: string } | null>(null);
  const chosen = picked?.threadId === thread.id && options.includes(picked.address) ? picked.address : null;
  // The worker knows nothing of the Settings default, so when it decides the From it is sent along with the reply.
  const usual = useMemo(() => (account ? defaultFrom(account, msgs) : ""), [account, msgs]);
  return { options, from: chosen ?? fallback, chosen, explicit: chosen ?? (fallback !== usual ? fallback : null), setFrom: (address) => setPicked({ threadId: thread.id, address }) };
}

export interface ReplyAllState {
  /** Email only: a chat has no one to copy. */
  available: boolean;
  all: boolean;
  setAll: (all: boolean) => void;
  toText: string;
  ccText: string;
  setToText: (text: string) => void;
  setCcText: (text: string) => void;
  /** What to send with the reply when Reply All is on. Undefined for a plain Reply, which the worker addresses. */
  copies: { to: string[]; cc: string[] } | undefined;
  /** Why Reply All cannot be sent yet. */
  error: string | null;
  /** Back to a plain Reply, once the reply is queued. */
  reset: () => void;
}

/**
 * Reply or Reply All. Reply All fills To with the sender of the message being answered and Cc with
 * everyone else it went to, minus your own addresses; both can be edited. A change of conversation,
 * of the message being answered or of who it came from starts the lines again.
 */
export function useReplyAll(thread: Thread, msgs: Message[], reply: ReplyFrom, leadTo?: string): ReplyAllState {
  const { replyTo } = useApp();
  const target = replyTo[thread.id];
  const available = thread.channel === "email";
  const lead = available && leadTo ? leadTo : undefined;
  const defaults = useMemo(() => (lead ? { to: [lead], cc: [] } : replyAllRecipients(msgs, reply.options, target)), [lead, msgs, reply.options, target]);
  const key = `${thread.id}|${target?.id ?? ""}|${defaults.to.join(",")}|${defaults.cc.join(",")}`;
  const [mode, setMode] = useState<string | null>(null); // the conversation Reply All is on for
  const [edit, setEdit] = useState<{ key: string; to: string; cc: string } | null>(null);
  // A lead address turns the addressed reply on by itself; switching it off is remembered as "off:<thread>".
  const all = available && (mode === thread.id || (!!lead && mode !== `off:${thread.id}`));
  const toText = edit?.key === key ? edit.to : defaults.to.join(", ");
  const ccText = edit?.key === key ? edit.cc : defaults.cc.join(", ");
  const parsed = useMemo(() => ({ to: parseAddresses(toText), cc: parseAddresses(ccText) }), [toText, ccText]);
  let error: string | null = null;
  if (all) {
    const bad = [...parsed.to.invalid, ...parsed.cc.invalid];
    if (bad.length) error = `Check ${bad.slice(0, 2).join(", ")}${bad.length > 2 ? " and others" : ""}.`;
    else if (parsed.to.valid.length + parsed.cc.valid.length === 0) error = "Add at least one address.";
    else if (parsed.to.valid.length > MAX_RECIPIENTS || parsed.cc.valid.length > MAX_RECIPIENTS) error = `Send to ${MAX_RECIPIENTS} people or fewer on each line.`;
  }
  return {
    available,
    all,
    setAll: (on) => setMode(on ? thread.id : lead ? `off:${thread.id}` : null),
    toText,
    ccText,
    setToText: (to) => setEdit({ key, to, cc: ccText }),
    setCcText: (cc) => setEdit({ key, to: toText, cc }),
    copies: all ? { to: parsed.to.valid, cc: parsed.cc.valid.filter((a) => !parsed.to.valid.includes(a)) } : undefined,
    error,
    reset: () => { setMode(null); setEdit(null); },
  };
}

interface Recipient {
  /** The person's or group's name. */
  name?: string;
  /** Their email address or phone number. */
  address?: string;
}

/** Who the reply goes to. */
function useRecipients(thread: Thread, msgs: Message[], reply: ReplyFrom): Recipient[] {
  const { contactById, replyTo } = useApp();
  const target = replyTo[thread.id];
  return useMemo(() => {
    const named = (name: string | undefined, address: string | undefined): Recipient =>
      ({ name: name && name !== address ? name : undefined, address });
    // An email reply to a chosen message goes to whoever sent it.
    if (thread.channel === "email" && target && target.from !== "me" && target.address) {
      return [named(contactById(target.from)?.name, target.address)];
    }
    if (thread.isGroup && thread.channel !== "email") return [{ name: thread.groupName ?? "Group" }];
    const participants = thread.participantIds.flatMap((id) => contactById(id) ?? []);
    if (thread.channel !== "email") {
      // A chat goes to the number; the stored sender can be a device id rather than a phone number.
      const c = participants[0];
      if (thread.channel === "instagram") return [named(c?.name, c?.handles?.[0] && `@${c.handles[0]}`)];
      const stored = replyRecipients(thread.channel, msgs, participants, [])[0]?.address;
      // A WhatsApp privacy ID ("...@lid") hides the number, so it is never shown as one.
      const number = c?.phones[0] ?? (stored?.includes("@") ? undefined : stored);
      return [named(c?.name, number && formatPhone(number))];
    }
    return replyRecipients("email", msgs, participants, reply.options)
      .map((r) => named(r.contactId ? contactById(r.contactId)?.name : undefined, r.address));
  }, [thread, msgs, contactById, reply.options, target]);
}

/**
 * The message being replied to, if one was picked, then who the reply goes to on the left and, for email,
 * which of your addresses it goes from on the right.
 */
export function ReplyHeader({ thread, msgs, reply, all }: { thread: Thread; msgs: Message[]; reply: ReplyFrom; all: ReplyAllState }) {
  const { contactById, replyTo, setReplyTo } = useApp();
  const target = replyTo[thread.id];
  const to = useRecipients(thread, msgs, reply).filter((r) => r.name || r.address);
  if (to.length === 0 && reply.options.length === 0 && !target && !all.available) return null;
  const email = thread.channel === "email";
  return (
    <>
      {target && <ReplyingTo target={target} author={target.from === "me" ? "You" : contactById(target.from)?.name ?? target.address ?? "Unknown"} onCancel={() => setReplyTo(thread.id, null)} />}
      {/* On a phone the names get their own line, with Reply and Writing As below them. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {/* Each person by name, with their address after it in angle brackets for email. */}
        <div className={cn("flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap max-md:basis-full", all.all && "hidden")}>
          {to.map((r, i) => (
            <Fragment key={i}>
              {r.name && <span className="shrink-0 text-sm font-medium">{r.name}</span>}
              {r.address && (
                <span className={cn("min-w-0 truncate", r.name ? "text-xs text-muted-foreground" : "text-sm font-medium")}>
                  {r.name && email ? `<${r.address}>` : r.address}
                </span>
              )}
              {i < to.length - 1 && <span className="-ml-1.5 text-xs text-muted-foreground">,</span>}
            </Fragment>
          ))}
        </div>
        {all.all && <div className="flex-1" />}
        {all.available && (
          <Select value={all.all ? "all" : "reply"} onValueChange={(v) => all.setAll(v === "all")}>
            <SelectTrigger aria-label="Reply Type" className="shrink-0 data-[size=default]:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="reply">Reply</SelectItem>
              <SelectItem value="all">Reply All</SelectItem>
            </SelectContent>
          </Select>
        )}
        {reply.options.length > 0 && <WritingAsChip value={reply.from} groups={[{ items: reply.options.map((a) => ({ value: a, label: a })) }]} onChange={reply.setFrom} />}
      </div>
      {all.all && (
        <div className="mb-3 grid gap-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="reply-to" className="w-7 shrink-0 text-xs text-muted-foreground">To</Label>
            <Input id="reply-to" className="h-8" value={all.toText} onChange={(e) => all.setToText(e.target.value)} aria-invalid={!!all.error} placeholder="name@example.com" />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="reply-cc" className="w-7 shrink-0 text-xs text-muted-foreground">Cc</Label>
            <Input id="reply-cc" className="h-8" value={all.ccText} onChange={(e) => all.setCcText(e.target.value)} aria-invalid={!!all.error} placeholder="name@example.com" />
          </div>
          {all.error && <p className="text-xs text-destructive">{all.error}</p>}
        </div>
      )}
    </>
  );
}

/** The message this reply answers, chosen with Reply on a message. */
function ReplyingTo({ target, author, onCancel }: { target: Message; author: string; onCancel: () => void }) {
  const snippet = target.body.trim() || target.attachments?.[0]?.name || "Attachment";
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md bg-muted/60 py-1.5 pr-1 pl-2.5 text-xs leading-5">
      <div className="min-w-0 flex-1">
        <div className="font-medium">Replying to {author}</div>
        <div className="truncate text-muted-foreground">{snippet}</div>
      </div>
      <Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label="Cancel Reply" onClick={onCancel}><X /></Button>
    </div>
  );
}
