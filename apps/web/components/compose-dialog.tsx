"use client";

// The New Email dialog, and useComposeSend, the queue-and-follow-the-outbox hook that New WhatsApp also uses.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markSubmitted } from "@/lib/analytics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { MAX_RECIPIENTS, parseAddresses, sendAddressesOf } from "@/lib/send-from";
import { attachProvider } from "@/lib/outbox-files";
import { enterSubmitsByAccident } from "@/lib/send-safety";
import { composeIsDirty } from "@/lib/compose-dirty";
import { cn } from "@/lib/utils";
import { AttachButton, AttachmentChips, useOutboxFiles } from "@/components/outbox-attachments";
import { ComposeAi, type Composed } from "@/components/compose-ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const POLL_MS = 4000; // in case a Realtime update is missed
const LINK_WAIT_MS = 30_000; // after it is sent, how long to wait for the conversation before giving up on opening it

/** Stops Enter in a single-line field from submitting the form. Shared with New WhatsApp. */
export function noEnterSubmit(e: React.KeyboardEvent<HTMLFormElement>) {
  const t = e.target as HTMLElement;
  if (enterSubmitsByAccident(e.key, t.tagName, (t as HTMLInputElement).type)) e.preventDefault();
}

/**
 * Sending a new email or WhatsApp message from a dialog: queue it, follow its outbox row, and once the
 * worker sets thread_id, close the dialog and open that conversation. reset() starts over.
 */
export function useComposeSend(open: boolean, onOpenChange: (open: boolean) => void, dialog: string) {
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
      }).catch(() => {
        // Let the next pass try again instead of leaving the dialog locked on a conversation that never opened.
        opened.current = null;
        toast("Could not open the conversation. Try again.");
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
      if (id) {
        markSubmitted(dialog);
        setOutboxId(id);
      }
    } catch {
      // Whatever threw, the dialog is usable again and says so.
      toast("Could not send. Your message is still in the box.");
    } finally {
      setQueueing(false);
    }
  }, [dialog]);
  const reset = useCallback(() => setOutboxId(null), []);

  return { sent, waiting, locked: waiting || sent, error: failed ? status.error : undefined, failed, run, reset };
}

/** A new email to anyone. Once the worker has sent it, the new conversation opens. */
export function ComposeDialog({ open, onOpenChange, to = [], subject: initialSubject = "", body: initialBody = "" }: { open: boolean; onOpenChange: (open: boolean) => void; to?: string[]; subject?: string; body?: string }) {
  const { accounts, contacts, composeEmail } = useApp();
  const sending = useComposeSend(open, onOpenChange, "compose");
  const { locked, sent, waiting, reset } = sending;
  const emailAccounts = useMemo(
    () => accounts.filter((a) => (a.provider === "icloud" || a.provider === "gmail" || a.provider === "outlook" || a.provider === "imap") && a.status !== "disconnected"),
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
  // Cc and Bcc stay out of the way until asked for.
  const [ccText, setCcText] = useState("");
  const [bccText, setBccText] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [checked, setChecked] = useState(false);
  const toKey = to.join(",");
  const applyDraft = useCallback((next: Composed) => {
    setBody(next.body);
    if (next.subject !== undefined) setSubject(next.subject);
    setDraftId(next.draftId);
  }, []);

  // Each time it opens it starts fresh, prefilled with whoever it was opened for.
  useEffect(() => {
    if (!open) return;
    setToText(to.join(", "));
    setCcText("");
    setBccText("");
    setShowCc(false);
    setShowBcc(false);
    setSubject(initialSubject);
    setBody(initialBody);
    setDraftId(undefined);
    setChecked(false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toKey]);

  const from = options.some((o) => o.addresses.some((x) => x.key === fromKey)) ? fromKey : firstKey;
  const recipients = useMemo(() => parseAddresses(toText), [toText]);
  // Who it is to, when the first address is a contact's, so a draft knows them and how you write to them.
  const firstTo = recipients.valid[0]?.toLowerCase();
  const contactId = useMemo(() => (firstTo ? contacts.find((c) => c.emails.some((e) => e.toLowerCase() === firstTo))?.id : undefined), [contacts, firstTo]);
  const toError = recipients.invalid.length
    ? `Check ${recipients.invalid.slice(0, 2).join(", ")}${recipients.invalid.length > 2 ? " and others" : ""}.`
    : recipients.valid.length === 0 ? "Add at least one address."
    : recipients.valid.length > MAX_RECIPIENTS ? `Send to ${MAX_RECIPIENTS} people or fewer.` : null;

  const ccRecipients = useMemo(() => parseAddresses(ccText), [ccText]);
  const bccRecipients = useMemo(() => parseAddresses(bccText), [bccText]);
  const listError = (r: { valid: string[]; invalid: string[] }) =>
    r.invalid.length ? `Check ${r.invalid.slice(0, 2).join(", ")}${r.invalid.length > 2 ? " and others" : ""}.`
    : r.valid.length > MAX_RECIPIENTS ? `Copy ${MAX_RECIPIENTS} people or fewer.` : null;
  const ccError = showCc ? listError(ccRecipients) : null;
  const bccError = showBcc ? listError(bccRecipients) : null;

  // Files go up when Send is pressed, then the email is queued with them. The limit follows the From account.
  const fromAccount = emailAccounts.find((a) => a.id === from.split(" ")[0]);
  const files = useOutboxFiles(attachProvider(fromAccount?.provider), locked);
  const clearFiles = files.clear;
  useEffect(() => { if (open) clearFiles(); }, [open, toKey, clearFiles]);
  const ready = !!from && (body.trim().length > 0 || files.items.length > 0) && !locked && !files.blocked && !ccError && !bccError;

  const submit = async () => {
    setChecked(true);
    if (!ready || toError || ccError || bccError) return;
    const [accountId, fromAddress] = from.split(" ");
    // A subject is one header line, so pasted line breaks become spaces rather than extra headers.
    const cleanSubject = subject.replace(/[\r\n]+/g, " ").trim();
    await sending.run(async () => {
      const uploaded = await files.upload();
      return uploaded ? composeEmail({
        accountId,
        fromAddress,
        to: recipients.valid,
        // Hidden fields are not sent, and nobody is on two lines.
        cc: showCc ? ccRecipients.valid.filter((a) => !recipients.valid.includes(a)) : [],
        bcc: showBcc ? bccRecipients.valid.filter((a) => !recipients.valid.includes(a) && !(showCc && ccRecipients.valid.includes(a))) : [],
        subject: cleanSubject,
        body,
        files: uploaded,
        draftId,
      }) : null;
    });
  };

  const keepWork = (e: Event) => {
    if (composeIsDirty({ to: toText, cc: ccText, bcc: bccText, subject, body }, { to, subject: initialSubject, body: initialBody })) e.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A click outside (or Escape) must not throw away an email you have started: Cancel closes it on purpose. */}
      <DialogContent showCloseButton={false} track="compose" onInteractOutside={keepWork} onEscapeKeyDown={keepWork} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Email</DialogTitle>
          <DialogDescription>Sent from your own account, then filed in the Inbox.</DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Connect iCloud+ Mail, Gmail, Outlook or another mailbox to send email. <Link href="/settings/accounts" className="underline underline-offset-4" onClick={() => onOpenChange(false)}>Connected Accounts</Link>
          </p>
        ) : (
          // Enter in To, Cc, Bcc or Subject must never send: only the Send button or Cmd/Ctrl Enter in the message does.
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} onKeyDown={noEnterSubmit} {...files.dropProps}>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="compose-to">To</Label>
                <div className="flex gap-1">
                  {!showCc && <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => setShowCc(true)}>Cc</Button>}
                  {!showBcc && <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => setShowBcc(true)}>Bcc</Button>}
                </div>
              </div>
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
            {showCc && (
              <div className="grid gap-2">
                <Label htmlFor="compose-cc">Cc</Label>
                <Input id="compose-cc" value={ccText} onChange={(e) => setCcText(e.target.value)} placeholder="name@example.com, another@example.com" aria-invalid={!!ccError} disabled={locked} autoFocus />
                {ccError && <p className="text-xs text-destructive">{ccError}</p>}
              </div>
            )}
            {showBcc && (
              <div className="grid gap-2">
                <Label htmlFor="compose-bcc">Bcc</Label>
                <Input id="compose-bcc" value={bccText} onChange={(e) => setBccText(e.target.value)} placeholder="name@example.com, another@example.com" aria-invalid={!!bccError} disabled={locked} autoFocus />
                {bccError && <p className="text-xs text-destructive">{bccError}</p>}
              </div>
            )}
            <ComposeAi
              open={open}
              sent={sent}
              disabled={locked}
              accountId={from ? from.split(" ")[0] : undefined}
              channel="email"
              contactId={contactId}
              body={body}
              subject={subject}
              onApply={applyDraft}
            />
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
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{locked ? "Close" : "Cancel"}</Button>
              <Button type="submit" variant="secondary" disabled={!ready}>{waiting ? "Sending" : sent ? "Sent" : "Send"}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}


