"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { MAX_RECIPIENTS, parseAddresses, sendAddressesOf } from "@/lib/send-from";
import { attachProvider } from "@/lib/outbox-files";
import { cn } from "@/lib/utils";
import { AttachButton, AttachmentChips, useOutboxFiles } from "@/components/outbox-attachments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const POLL_MS = 4000; // in case a Realtime update is missed
const LINK_WAIT_MS = 30_000; // after it is sent, how long to wait for the conversation before giving up on opening it

/**
 * Sending a new email or WhatsApp message from a dialog: queue it, follow its outbox row, and once the
 * worker sets thread_id, close the dialog and open that conversation. reset() starts over.
 */
export function useComposeSend(open: boolean, onOpenChange: (open: boolean) => void) {
  const router = useRouter();
  const { composed, refreshCompose, ensureThread } = useApp();
  const [outboxId, setOutboxId] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const opened = useRef<string | null>(null); // the outbox row whose conversation was opened
  const close = useRef(onOpenChange);
  close.current = onOpenChange;

  const status = outboxId ? composed[outboxId] : undefined;
  // Sent counts as done even before the conversation is linked, so it is never sent twice.
  const sent = status?.status === "sent";
  const failed = status?.status === "failed";
  const waiting = queueing || (!!outboxId && !failed && !sent);
  const threadId = status?.threadId;

  useEffect(() => {
    if (!outboxId || !open) return;
    if (threadId) {
      if (opened.current === outboxId) return;
      opened.current = outboxId;
      ensureThread(threadId).then(() => {
        close.current(false);
        router.push(`/inbox/${threadId}`);
      });
      return;
    }
    if (failed) return;
    const t = setInterval(() => refreshCompose(outboxId), POLL_MS);
    const stop = sent ? setTimeout(() => clearInterval(t), LINK_WAIT_MS) : undefined;
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [outboxId, open, threadId, failed, sent, ensureThread, refreshCompose, router]);

  /** Runs queue, which resolves to the new outbox row's id (or null when nothing was queued), and follows it. */
  const run = useCallback(async (queue: () => Promise<string | null>) => {
    setQueueing(true);
    try {
      const id = await queue();
      if (id) setOutboxId(id);
    } finally {
      setQueueing(false);
    }
  }, []);
  const reset = useCallback(() => setOutboxId(null), []);

  return { sent, waiting, locked: waiting || sent, error: failed ? status.error : undefined, failed, run, reset };
}

/** A new email to anyone. Once the worker has sent it, the new conversation opens. */
export function ComposeDialog({ open, onOpenChange, to = [] }: { open: boolean; onOpenChange: (open: boolean) => void; to?: string[] }) {
  const { accounts, composeEmail } = useApp();
  const sending = useComposeSend(open, onOpenChange);
  const { locked, sent, waiting, reset } = sending;
  const emailAccounts = useMemo(
    () => accounts.filter((a) => (a.provider === "icloud" || a.provider === "gmail") && a.status !== "disconnected"),
    [accounts],
  );
  // One option per address, keyed by account and address so the same address on two accounts stays distinct.
  const options = useMemo(
    () => emailAccounts.map((a) => ({ account: a, addresses: sendAddressesOf(a).map((address) => ({ key: `${a.id} ${address}`, address })) })),
    [emailAccounts],
  );
  const firstKey = options[0]?.addresses[0]?.key ?? "";

  const [fromKey, setFromKey] = useState("");
  const [toText, setToText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [checked, setChecked] = useState(false);
  const toKey = to.join(",");

  // Each time it opens it starts fresh, prefilled with whoever it was opened for.
  useEffect(() => {
    if (!open) return;
    setToText(to.join(", "));
    setSubject("");
    setBody("");
    setChecked(false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toKey]);

  const from = options.some((o) => o.addresses.some((x) => x.key === fromKey)) ? fromKey : firstKey;
  const recipients = useMemo(() => parseAddresses(toText), [toText]);
  const toError = recipients.invalid.length
    ? `Check ${recipients.invalid.slice(0, 2).join(", ")}${recipients.invalid.length > 2 ? " and others" : ""}.`
    : recipients.valid.length === 0 ? "Add at least one address."
    : recipients.valid.length > MAX_RECIPIENTS ? `Send to ${MAX_RECIPIENTS} people or fewer.` : null;

  // Files go up when Send is pressed, then the email is queued with them. The limit follows the From account.
  const fromAccount = emailAccounts.find((a) => a.id === from.split(" ")[0]);
  const files = useOutboxFiles(attachProvider(fromAccount?.provider), locked);
  const clearFiles = files.clear;
  useEffect(() => { if (open) clearFiles(); }, [open, toKey, clearFiles]);
  const ready = !!from && (body.trim().length > 0 || files.items.length > 0) && !locked && !files.blocked;

  const submit = async () => {
    setChecked(true);
    if (!ready || toError) return;
    const [accountId, fromAddress] = from.split(" ");
    await sending.run(async () => {
      const uploaded = await files.upload();
      return uploaded ? composeEmail({ accountId, fromAddress, to: recipients.valid, subject, body, files: uploaded }) : null;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Email</DialogTitle>
          <DialogDescription>Sent from your own account, then filed in Conversations.</DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              Connect iCloud+ Mail or Gmail to send email. <Link href="/settings/accounts" className="underline underline-offset-4" onClick={() => onOpenChange(false)}>Connected Accounts</Link>
            </p>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} {...files.dropProps}>
            <div className="grid gap-2">
              <Label htmlFor="compose-from">From</Label>
              <Select value={from} onValueChange={setFromKey} disabled={locked}>
                <SelectTrigger id="compose-from" className="w-full"><SelectValue placeholder="Choose an Address" /></SelectTrigger>
                <SelectContent>
                  {options.map((o, i) => (
                    <SelectGroup key={o.account.id}>
                      {i > 0 && <SelectSeparator />}
                      <SelectLabel>{o.account.label}</SelectLabel>
                      {o.addresses.map((x) => <SelectItem key={x.key} value={x.key}>{x.address}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="compose-to">To</Label>
              <Input
                id="compose-to"
                value={toText}
                onChange={(e) => setToText(e.target.value)}
                onBlur={() => toText.trim() && setChecked(true)}
                placeholder="name@example.com, another@example.com"
                aria-invalid={checked && !!toError}
                disabled={locked}
                autoFocus={to.length === 0}
              />
              {checked && toError && <p className="text-xs text-destructive">{toError}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="compose-subject">Subject</Label>
              <Input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={locked} autoFocus={to.length > 0} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="compose-body">Message</Label>
              <Textarea
                id="compose-body"
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
                onPaste={files.onPaste}
                disabled={locked}
                className={cn("max-h-80", files.dragging && "border-ring ring-3 ring-ring/30")}
              />
            </div>
            <AttachmentChips files={files} />
            {sent && <p className="text-xs text-muted-foreground">Sent. The conversation opens here once it is filed.</p>}
            {sending.failed && <p className="text-xs text-destructive">{sending.error ?? "The email could not be sent."}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AttachButton files={files} className="self-start sm:mr-auto" />
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{locked ? "Close" : "Cancel"}</Button>
              <Button type="submit" disabled={!ready}>{waiting ? "Sending" : sent ? "Sent" : "Send"}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}


