"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { FIELD } from "@messages/crypto/fields";
import { markSubmitted } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";
import { seal } from "@/lib/vault";
import { sealAddress } from "@/lib/address-refs";
import { useApp } from "@/lib/store";
import { existingLinkedInChat, LINKEDIN_HINT, linkedinAccounts, parseLinkedInProfile, searchLinkedInContacts } from "@/lib/new-linkedin";
import { ContactAvatar } from "@/components/primitives";
import { useComposeSend } from "@/components/compose-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ITEM = "p-2 [&>svg:last-child]:hidden";

/**
 * Queues a first LinkedIn message and resolves to the outbox row's id, or null when it could not be queued. Sealed
 * like a new WhatsApp chat (the body and the one recipient), with no conversation: the worker sends it, then
 * links the new conversation to the row.
 */
export async function queueLinkedIn(accountId: string, to: string, body: string, draftId?: string): Promise<string | null> {
  const sealed = await seal(FIELD.body, body).catch(() => null);
  const { data, error } = sealed === null ? { data: null, error: true } : await supabase.from("outbox")
    .insert({ account_id: accountId, to_addresses: [await sealAddress(to)], body: sealed, attachment_count: 0, draft_id: draftId ?? null })
    .select("id").single();
  if (error || !data) {
    toast("Could not send. Your message is still in the box.");
    return null;
  }
  return data.id;
}

/** A first LinkedIn message to someone, by their profile link or from your contacts. Once the worker has sent it, the conversation opens. */
export function NewLinkedInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { accounts, contacts, threads, send } = useApp();
  const sending = useComposeSend(open, onOpenChange, "new_linkedin");
  const { locked, sent, waiting, reset } = sending;
  const options = useMemo(() => linkedinAccounts(accounts), [accounts]);

  const [accountId, setAccountId] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ value: string; label: string; contactId?: string } | null>(null);
  const [body, setBody] = useState("");
  const [checked, setChecked] = useState(false);
  const [toFocused, setToFocused] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Each time it opens it starts fresh, on the first account that can send.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked(null);
    setBody("");
    setChecked(false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const account = options.find((a) => a.id === accountId) ?? options[0];

  const typed = parseLinkedInProfile(query);
  const target = picked?.value ?? typed;
  const toError = target ? null : query.trim() ? LINKEDIN_HINT : "Choose someone or paste a LinkedIn profile link.";
  const suggestions = useMemo(() => searchLinkedInContacts(contacts, query), [contacts, query]);
  const chat = useMemo(
    () => (picked?.contactId ? existingLinkedInChat(threads, picked.contactId, account?.id) : undefined),
    [threads, picked, account?.id],
  );
  const ready = !!account && body.trim().length > 0 && !locked;

  const pick = (value: string, label: string, contactId?: string) => {
    setPicked({ value, label, contactId });
    setQuery("");
    requestAnimationFrame(() => bodyRef.current?.focus());
  };

  const openChat = (threadId: string) => {
    onOpenChange(false);
    router.push(`/inbox/${threadId}`);
  };

  const submit = async () => {
    setChecked(true);
    if (!account || !ready || !target) return;
    await sending.run(async () => {
      // A conversation with this person already exists, so the message goes there as a reply instead.
      if (chat) {
        if (await send(chat.id, body, undefined, [], true)) {
          markSubmitted("new_linkedin");
          openChat(chat.id);
        }
        return null;
      }
      return queueLinkedIn(account.id, target, body);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="new_linkedin" showCloseButton={false} className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New LinkedIn Message</DialogTitle>
          <DialogDescription>Sent from your linked LinkedIn, then shown in the Inbox. LinkedIn may only allow messages to people you are connected with.</DialogDescription>
        </DialogHeader>
        {!account ? (
          <p className="text-sm text-muted-foreground">
            Link LinkedIn first to start a conversation. <Link href="/settings/accounts/linkedin" className="underline underline-offset-4" onClick={() => onOpenChange(false)}>Link LinkedIn</Link>
          </p>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {options.length > 1 && (
              <div className="grid gap-2">
                <Label htmlFor="linkedin-from">From</Label>
                <Select value={account.id} onValueChange={setAccountId} disabled={locked}>
                  <SelectTrigger id="linkedin-from" className="h-10 w-full"><SelectValue placeholder="Choose an Account" /></SelectTrigger>
                  <SelectContent>
                    {options.map((a, i) => <SelectItem key={a.id} value={a.id}>{a.nickname || `${a.label} ${i + 1}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="linkedin-to">To</Label>
              {picked ? (
                <div className="flex h-10 items-center gap-2 rounded-md border pr-1 pl-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{picked.label}</span>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Change Recipient" disabled={locked} onClick={() => setPicked(null)}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <Command shouldFilter={false} className="-mx-1 -mt-1 w-auto overflow-visible bg-transparent p-0">
                  <CommandInput
                    id="linkedin-to"
                    value={query}
                    onValueChange={setQuery}
                    onFocus={() => setToFocused(true)}
                    onBlur={() => {
                      setToFocused(false);
                      if (!query.trim()) return;
                      // A full profile link typed and left becomes the recipient, as if it had been picked.
                      if (typed) pick(typed, typed.replace("https://www.", ""));
                      else setChecked(true);
                    }}
                    placeholder="Name, or a profile link like linkedin.com/in/jane-doe"
                    aria-invalid={checked && !!toError}
                    disabled={locked}
                    autoFocus
                  />
                  {toFocused && query.trim() && (typed || suggestions.length > 0) && (
                    // Keeps the focus in the input while an item is clicked, so the list stays until it is picked.
                    <CommandList className="mx-1 mt-1 rounded-lg border" onMouseDown={(e) => e.preventDefault()}>
                      {typed && (
                        <CommandGroup>
                          <CommandItem value={`link ${typed}`} className={ITEM} onSelect={() => pick(typed, typed.replace("https://www.", ""))}>
                            Message <span className="min-w-0 truncate">{typed.replace("https://www.", "")}</span>
                          </CommandItem>
                        </CommandGroup>
                      )}
                      {suggestions.length > 0 && (
                        <CommandGroup heading="Contacts">
                          {suggestions.map(({ contact, urn }) => (
                            <CommandItem key={contact.id} value={`${contact.id} ${urn}`} className={ITEM} onSelect={() => pick(urn, contact.name, contact.id)}>
                              <ContactAvatar contact={contact} className="size-6" />
                              <span className="min-w-0 truncate">{contact.name}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  )}
                </Command>
              )}
              {checked && toError && <p className="text-xs text-destructive">{toError}</p>}
              {chat && !locked && (
                <p className="text-xs text-muted-foreground">
                  You already have a conversation with them, so your message goes there. <button type="button" className="underline underline-offset-4" onClick={() => openChat(chat.id)}>Open Conversation</button>
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="linkedin-body">Message</Label>
              <Textarea
                id="linkedin-body"
                ref={bodyRef}
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
                disabled={locked}
                className="max-h-80"
              />
            </div>
            {sent && <p className="text-xs text-muted-foreground">Sent. The conversation opens here once it is stored.</p>}
            {sending.failed && <p className="text-xs text-destructive">{sending.error ?? "The message could not be sent."}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{locked ? "Close" : "Cancel"}</Button>
              <Button type="submit" variant="secondary" disabled={!ready || (checked && !!toError)}>{waiting ? "Sending" : sent ? "Sent" : "Send"}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
