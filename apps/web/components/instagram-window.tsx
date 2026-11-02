"use client";

// Instagram lets a Business or Creator account reply only within 24 hours of the other person's last message, or
// 7 days when Meta granted the app Human Agent (lib/instagram-reply-window.ts). The Instagram connector enforces it
// (it refuses a later reply and the bubble says so, like any reply that could not go); this tells you before you
// write one. A personal account is not held to it.

import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import type { Account, Message, Thread } from "@/lib/types";
import { humanAgentOn, replyWindow, windowClosesAt } from "@/lib/instagram-reply-window";
import { INSTAGRAM_OFFICIAL_LABEL } from "@/app/api/connect/instagram/official/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const HUMAN_AGENT = humanAgentOn();

/** What the connector records on a reply Instagram refused for the window (OUTSIDE_WINDOW in connectors/instagram/official.py). */
const REFUSED = "Instagram only allows a reply within 24 hours of their last message. Send this one in Instagram.";

const lastFromThem = (msgs: Pick<Message, "from" | "sentAt">[]) =>
  msgs.reduce((latest, m) => (m.from === "me" ? latest : Math.max(latest, new Date(m.sentAt).getTime())), 0);

/** A Business or Creator account on the official API, which the connector saves under this label. */
export function isOfficialInstagram(account: Pick<Account, "provider" | "label"> | undefined): boolean {
  return account?.provider === "instagram" && account.label === INSTAGRAM_OFFICIAL_LABEL;
}

/**
 * Whether a reply to this conversation has to be sent in Instagram: it is one, on the official API, and the reply window has closed (24 hours after they last wrote, 7 with Human Agent, or they never did).
 * A reply Instagram refused for the window counts too, until they write again.
 */
export function instagramReplyClosed(thread: Pick<Thread, "channel" | "accountId">, msgs: Pick<Message, "from" | "sentAt" | "sendState" | "sendError">[], accounts: Account[], now = Date.now(), humanAgent = HUMAN_AGENT): boolean {
  if (thread.channel !== "instagram" || !isOfficialInstagram(accounts.find((a) => a.id === thread.accountId))) return false;
  const last = lastFromThem(msgs);
  if (replyWindow(last, now, humanAgent) === "closed") return true;
  return msgs.some((m) => m.sendState === "failed" && m.sendError === REFUSED && new Date(m.sentAt).getTime() > last);
}

/** True when the composer should show the notice and hold Send. It closes by itself at the 24 hour mark and opens when they write. */
export function useInstagramReplyClosed(thread: Pick<Thread, "channel" | "accountId">, msgs: Pick<Message, "from" | "sentAt" | "sendState" | "sendError">[]): boolean {
  const { accounts } = useApp();
  const [, tick] = useState(0);
  // Nothing loaded yet is not a closed window: it would flash the notice. The connector refuses a late reply anyway.
  const closed = msgs.length > 0 && instagramReplyClosed(thread, msgs, accounts);
  const last = lastFromThem(msgs);
  const watch = msgs.length > 0 && !closed && last > 0 && thread.channel === "instagram" && isOfficialInstagram(accounts.find((a) => a.id === thread.accountId));
  useEffect(() => {
    if (!watch) return;
    const id = setTimeout(() => tick((n) => n + 1), Math.max(windowClosesAt(last, Date.now(), HUMAN_AGENT) - Date.now(), 0) + 1000);
    return () => clearTimeout(id);
  }, [watch, last]);
  return closed;
}

/** Shown above the composer in place of Send when a reply has to be sent in Instagram. */
export function InstagramReplyNotice() {
  return (
    <Alert className="mb-3">
      <AlertTitle>Reply Window Closed</AlertTitle>
      <AlertDescription>Instagram only allows a reply within {HUMAN_AGENT ? "7 days" : "24 hours"} of their last message. Reply in the Instagram app, or wait for them to message you again. You can still write a draft to copy.</AlertDescription>
    </Alert>
  );
}
