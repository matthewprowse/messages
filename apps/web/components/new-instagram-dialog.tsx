"use client";

// The dialog for a first Instagram message to a username. It queues the message; the Instagram connector sends it and opens the conversation.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FIELD } from "@messages/crypto/fields";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { seal } from "@/lib/vault";
import { sealAddress } from "@/lib/address-refs";
import { outboxPlace } from "@/lib/outbox-places";
import { INSTAGRAM_HINT, INSTAGRAM_OFFICIAL_NOTICE, instagramAccounts, instagramUsername, isOfficialAccount } from "@/lib/new-instagram";
import { useComposeSend } from "@/components/compose-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Queues a first Instagram message: the outbox row has no conversation, one sealed username and a sealed body.
 * The sign-in connector sends it and sets thread_id. Resolves to the new row's id, or null when it could not be queued.
 */
export async function queueInstagramChat(accountId: string, username: string, body: string): Promise<string | null> {
  // The id is chosen here so the body and username are sealed for this row alone (outbox-places.ts).
  const id = crypto.randomUUID();
  const sealed = await seal(FIELD.body, body, outboxPlace(id, "body")).catch(() => null);
  const sealedTo = await sealAddress(username, outboxPlace(id, "to_addresses")).catch(() => null);
  const { data, error } = sealed === null || sealedTo === null ? { data: null, error: true } : await supabase.from("outbox")
    .insert({ id, account_id: accountId, to_addresses: [sealedTo], body: sealed, attachment_count: 0 })
    .select("id").single();
  if (error || !data) {
    toast("Could not send. Your message is still in the box.");
    return null;
  }
  return data.id;
}

export { instagramLinked } from "@/lib/new-instagram";

/** A first Instagram message to a username. Once the connector has sent it, the conversation opens. */
export function NewInstagramDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { accounts } = useApp();
  const sending = useComposeSend(open, onOpenChange, "new_instagram");
  const { locked, sent, waiting, reset } = sending;
  const options = useMemo(() => instagramAccounts(accounts), [accounts]);

  const [accountKey, setAccountKey] = useState("");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [checked, setChecked] = useState(false);

  // Each time it opens it starts fresh.
  useEffect(() => {
    if (!open) return;
    setTo("");
    setBody("");
    setChecked(false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const account = options.find((a) => a.id === accountKey) ?? options[0];
  const official = !!account && isOfficialAccount(account);
  const username = instagramUsername(to);
  const toError = username ? null : to.trim() ? INSTAGRAM_HINT : "Enter an Instagram username.";
  const ready = !!account && !official && !!username && body.trim().length > 0 && !locked;

  const submit = async () => {
    setChecked(true);
    if (!account || !ready || !username) return;
    await sending.run(() => queueInstagramChat(account.id, username, body));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="new_instagram" className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Instagram Message</DialogTitle>
          <DialogDescription>Sent from your connected Instagram, then shown in the Inbox.</DialogDescription>
        </DialogHeader>
        {!account ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Connect Instagram first to start a conversation. <Link href="/settings/accounts/instagram" className="underline underline-offset-4" onClick={() => onOpenChange(false)}>Connect Instagram</Link>
            </p>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {options.length > 1 && (
              <div className="grid gap-2">
                <Label htmlFor="instagram-from">From</Label>
                <Select value={account.id} onValueChange={setAccountKey} disabled={locked}>
                  <SelectTrigger id="instagram-from" className="w-full"><SelectValue placeholder="Choose an Account" /></SelectTrigger>
                  <SelectContent>
                    {options.map((a) => <SelectItem key={a.id} value={a.id}>{a.detail || a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {official && (
              <Alert>
                <AlertTitle>Cannot Start Conversations</AlertTitle>
                <AlertDescription>{INSTAGRAM_OFFICIAL_NOTICE}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              <Label htmlFor="instagram-to">To</Label>
              <Input
                id="instagram-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                onBlur={() => { if (to.trim()) setChecked(true); }}
                placeholder="Username, like ana.m"
                aria-invalid={checked && !!toError}
                disabled={locked || official}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
              {checked && toError && <p className="text-xs text-destructive">{toError}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="instagram-body">Message</Label>
              <Textarea
                id="instagram-body"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
                disabled={locked || official}
                className="max-h-80"
              />
              <p className="text-xs text-muted-foreground">Instagram only allows a few new conversations each day, so extra ones may be refused.</p>
            </div>
            {sent && <p className="text-xs text-muted-foreground">Sent. The conversation opens here once it is stored.</p>}
            {sending.failed && <p className="text-xs text-destructive">{sending.error ?? "The message could not be sent."}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="submit" variant="secondary" disabled={!ready || (checked && !!toError)}>{waiting ? "Sending" : sent ? "Sent" : "Send"}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
