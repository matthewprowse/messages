"use client";

// The dialog for a first WhatsApp message to a number or contact. It queues the message and opens the chat once the worker has sent it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markSubmitted } from "@/lib/analytics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useApp } from "@/lib/store";
import { defaultCountryCode, existingChat, normalisePhone, PHONE_HINT, searchPhoneContacts, linkedAccount } from "@/lib/new-items";
import { ContactAvatar } from "@/components/primitives";
import { useComposeSend } from "@/components/compose-dialog";
import { ComposeAi, type Composed } from "@/components/compose-ai";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPhone } from "@/lib/format";

const ITEM = "p-2 [&>svg:last-child]:hidden";

/** The linked WhatsApp account that can send, if there is one. */
export { whatsappLinked } from "@/lib/new-items";

/** A first WhatsApp message to anyone. Once the worker has sent it, the chat opens. */
export function NewWhatsAppDialog({ open, onOpenChange, to }: { open: boolean; onOpenChange: (open: boolean) => void; to?: { phone: string; name?: string } }) {
  const router = useRouter();
  const { accounts, contacts, contactById, threads, composeWhatsApp, send } = useApp();
  const sending = useComposeSend(open, onOpenChange, "new_whatsapp");
  const { locked, sent, waiting, reset } = sending;
  const account = linkedAccount(accounts);
  // Your own linked number decides the country first, so an old unlinked one does not.
  const country = useMemo(() => defaultCountryCode(account ? [account] : accounts), [account, accounts]);

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ phone: string; name?: string } | null>(null);
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [checked, setChecked] = useState(false);
  const applyDraft = useCallback((next: Composed) => { setBody(next.body); setDraftId(next.draftId); }, []);
  const [toFocused, setToFocused] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const toKey = to?.phone ?? "";

  // Each time it opens it starts fresh, prefilled with whoever it was opened for.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked(to ?? null);
    setBody("");
    setDraftId(undefined);
    setChecked(false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toKey]);

  const typed = normalisePhone(query, country);
  const number = picked?.phone ?? typed;
  const toError = number ? null : query.trim() ? PHONE_HINT : "Choose someone or enter a phone number.";
  const accountId = account?.id;
  const chat = useMemo(
    () => (number ? existingChat(threads, number, accountId, (id) => contactById(id)?.phones) : undefined),
    [threads, number, accountId, contactById],
  );
  const suggestions = useMemo(() => searchPhoneContacts(contacts, query), [contacts, query]);
  // Who it is to, when the number is a contact's, so a draft knows them and how you write to them.
  const contactId = useMemo(
    () => (number ? contacts.find((c) => c.phones.some((p) => p === number || normalisePhone(p, country) === number))?.id : undefined),
    [contacts, number, country],
  );
  const ready = !!account && body.trim().length > 0 && !locked;

  const pick = (phone: string, name?: string) => {
    setPicked({ phone, name });
    setQuery("");
    requestAnimationFrame(() => bodyRef.current?.focus());
  };

  const openChat = (threadId: string) => {
    onOpenChange(false);
    router.push(`/inbox/${threadId}`);
  };

  const submit = async () => {
    setChecked(true);
    if (!account || !ready || !number) return;
    await sending.run(async () => {
      // A chat with this number already exists, so the message goes there as a reply instead.
      if (chat) {
        // Standalone, so the chat's AI draft and Reply-to are left alone.
        if (await send(chat.id, body, undefined, [], true)) {
          markSubmitted("new_whatsapp");
          openChat(chat.id);
        }
        return null;
      }
      return composeWhatsApp(account.id, number, body, draftId);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="new_whatsapp" showCloseButton className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New WhatsApp Message</DialogTitle>
          <DialogDescription>Sent from your linked WhatsApp, then shown in the Inbox.</DialogDescription>
        </DialogHeader>
        {!account ? (
          <p className="text-sm text-muted-foreground">
            Link WhatsApp first to start a chat. <Link href="/settings/accounts/whatsapp" className="underline underline-offset-4" onClick={() => onOpenChange(false)}>Link WhatsApp</Link>
          </p>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="grid gap-2">
              <Label htmlFor="whatsapp-to">To</Label>
              {picked ? (
                <div className="flex h-10 items-center gap-2 rounded-md border pr-1 pl-3">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {picked.name && <span className="mr-2">{picked.name}</span>}
                    <span className="text-muted-foreground tabular-nums">{formatPhone(picked.phone)}</span>
                  </span>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label="Change Recipient" disabled={locked} onClick={() => setPicked(null)}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <Command shouldFilter={false} className="-mx-1 -mt-1 w-auto overflow-visible bg-transparent p-0">
                  <CommandInput
                    id="whatsapp-to"
                    value={query}
                    onValueChange={setQuery}
                    onFocus={() => setToFocused(true)}
                    onBlur={() => {
                      setToFocused(false);
                      if (!query.trim()) return;
                      // A full number typed and left becomes the recipient, as if it had been picked.
                      if (typed) setPicked({ phone: typed });
                      else setChecked(true);
                    }}
                    placeholder="Name or number, like +44 7700 900123"
                    aria-invalid={checked && !!toError}
                    disabled={locked}
                    autoFocus
                  />
                  {toFocused && query.trim() && (typed || suggestions.length > 0) && (
                    // Keeps the focus in the input while an item is clicked, so the list stays until it is picked.
                    <CommandList className="mx-1 mt-1 rounded-lg border" onMouseDown={(e) => e.preventDefault()}>
                      {typed && (
                        <CommandGroup>
                          <CommandItem value={`number ${typed}`} className={ITEM} onSelect={() => pick(typed)}>
                            Message <span className="tabular-nums">{typed}</span>
                          </CommandItem>
                        </CommandGroup>
                      )}
                      {suggestions.length > 0 && (
                        <CommandGroup heading="Contacts">
                          {suggestions.map(({ contact, phone }) => (
                            <CommandItem key={`${contact.id} ${phone}`} value={`${contact.id} ${phone}`} className={ITEM} onSelect={() => pick(phone, contact.name)}>
                              <ContactAvatar contact={contact} className="size-6" />
                              <span className="min-w-0 truncate">{contact.name}</span>
                              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatPhone(phone)}</span>
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
                  You already have a chat with this number, so your message goes there. <button type="button" className="underline underline-offset-4" onClick={() => openChat(chat.id)}>Open Chat</button>
                </p>
              )}
            </div>
            <ComposeAi
              open={open}
              sent={sent}
              disabled={locked}
              accountId={account.id}
              channel="whatsapp"
              contactId={contactId}
              body={body}
              onApply={applyDraft}
            />
            <div className="grid gap-2">
              <Label htmlFor="whatsapp-body">Message</Label>
              <Textarea
                id="whatsapp-body"
                ref={bodyRef}
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
                disabled={locked}
                autoFocus={!!to}
                className="max-h-80"
              />
            </div>
            {sent && <p className="text-xs text-muted-foreground">Sent. The chat opens here once it is stored.</p>}
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
