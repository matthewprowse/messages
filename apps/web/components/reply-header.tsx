"use client";

import { Fragment, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useApp } from "@/lib/store";
import type { Message, Thread } from "@/lib/types";
import { defaultFrom, replyRecipients, sendAddressesOf } from "@/lib/send-from";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/format";

export interface ReplyFrom {
  options: string[];
  /** The From address shown, or "" when the account is unknown and the worker picks. */
  from: string;
  /** Set only when you picked one. Otherwise the worker applies the same default from the stored mail. */
  chosen: string | null;
  setFrom: (address: string) => void;
}

/** The From address for a reply: picked by you, else the address the latest email was sent to. */
export function useReplyFrom(thread: Thread, msgs: Message[]): ReplyFrom {
  const { accounts } = useApp();
  const account = thread.channel === "email" ? accounts.find((a) => a.id === thread.accountId) : undefined;
  const options = useMemo(() => (account ? sendAddressesOf(account) : []), [account]);
  const fallback = useMemo(() => (account ? defaultFrom(account, msgs) : ""), [account, msgs]);
  // Kept per conversation, so a pick does not follow you into the next one.
  const [picked, setPicked] = useState<{ threadId: string; address: string } | null>(null);
  const chosen = picked?.threadId === thread.id && options.includes(picked.address) ? picked.address : null;
  return { options, from: chosen ?? fallback, chosen, setFrom: (address) => setPicked({ threadId: thread.id, address }) };
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
export function ReplyHeader({ thread, msgs, reply }: { thread: Thread; msgs: Message[]; reply: ReplyFrom }) {
  const { contactById, replyTo, setReplyTo } = useApp();
  const target = replyTo[thread.id];
  const to = useRecipients(thread, msgs, reply).filter((r) => r.name || r.address);
  if (to.length === 0 && reply.options.length === 0 && !target) return null;
  const email = thread.channel === "email";
  return (
    <>
      {target && <ReplyingTo target={target} author={target.from === "me" ? "You" : contactById(target.from)?.name ?? target.address ?? "Unknown"} onCancel={() => setReplyTo(thread.id, null)} />}
      <div className="mb-3 flex items-center justify-between gap-3">
        {/* Each person by name, with their address after it in angle brackets for email. */}
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
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
        {reply.options.length > 0 && (
          <Select value={reply.from} onValueChange={reply.setFrom}>
            <SelectTrigger aria-label="From" className="max-w-64 min-w-0 shrink-0 data-[size=default]:h-8">
              <SelectValue placeholder="From" />
            </SelectTrigger>
            <SelectContent align="end">
              {reply.options.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
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
