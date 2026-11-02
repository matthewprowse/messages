// Sending: replies queued in the outbox, new emails and WhatsApp chats, the Reply-to choice and the account's send
// addresses. The worker does the sending; these rows are the hand-off (see AGENTS.md).

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { FIELD } from "@messages/crypto/fields";
import { draftEdit } from "@messages/analytics/draft";
import { supabase } from "../supabase";
import { pendingAttachments, type OutboxUpload } from "../outbox-files";
import { seal } from "../vault";
import { createSendKeys, insertOnce, sendRecovery, sendSignature } from "../send-safety";
import { rememberDismissed } from "../outbox-load";
import { sealAddress } from "../address-refs";
import { track } from "../analytics";
import type { Message, Thread } from "../types";
import { ComposeStatus, NewEmail, PendingSend, attachToOutbox, composeStatusOf } from "./compose";
import type { Action, State } from "./reducer";

export interface OutboxDeps {
  rawDispatch: React.Dispatch<Action>;
  stateRef: React.MutableRefObject<State>;
  threadMapRef: React.MutableRefObject<Map<string, Thread>>;
  pendingRef: React.MutableRefObject<PendingSend[]>;
  draftAskRef: React.MutableRefObject<Record<string, number | undefined>>;
  setPending: React.Dispatch<React.SetStateAction<PendingSend[]>>;
  setComposed: React.Dispatch<React.SetStateAction<Record<string, ComposeStatus | undefined>>>;
  saveFailed: () => void;
}

/** The sending actions of the context, plus the Reply-to state. */
export function useOutbox({ rawDispatch, stateRef, threadMapRef, pendingRef, draftAskRef, setPending, setComposed, saveFailed }: OutboxDeps) {
  // Keys of unsettled sends, so Send pressed again after a lost answer reuses the same outbox id.
  const sendKeysRef = useRef(createSendKeys());
  // A failed send you have deleted, or retried as a new send: it leaves the conversation for good.
  // A failed row cannot be deleted in the database, so a deleted one is also remembered here and stays gone after a reload.
  const removePending = useCallback((outboxId: string) => { rememberDismissed(outboxId); setPending((p) => p.filter((x) => x.id !== outboxId)); }, []);

  const [replyTo, setReplyToState] = useState<Record<string, Message | undefined>>({});
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const setReplyTo = useCallback((threadId: string, message: Message | null) => {
    setReplyToState((r) => ({ ...r, [threadId]: message ?? undefined }));
  }, []);

  const send = useCallback(async (threadId: string, body: string, fromAddress?: string, files: OutboxUpload[] = [], standalone = false, copies?: { to: string[]; cc: string[] }) => {
    // A reply that started as an AI draft keeps the link, so the AI can learn from what you changed.
    const draftId = standalone ? null : threadMapRef.current.get(threadId)?.draft?.id ?? null;
    const replyToId = standalone ? null : replyToRef.current[threadId]?.id ?? null;
    const sealed = await seal(FIELD.body, body).catch(() => null);
    // Addresses are sealed like the body: a failed key request is a failed send, not an unhandled rejection.
    const addresses = sealed === null ? null : await Promise.all([
      fromAddress ? sealAddress(fromAddress) : Promise.resolve(null),
      copies ? Promise.all(copies.to.map((a) => sealAddress(a))) : Promise.resolve(null),
      copies ? Promise.all(copies.cc.map((a) => sealAddress(a))) : Promise.resolve(null),
    ]).catch(() => null);
    // The placeholder is in before the insert resolves: a fast worker can update the row first, and the outbox
    // handler (use-realtime.ts) only updates placeholders that already exist. Its id is chosen here for the same reason.
    // The id is kept for as long as the message is unsettled, so Send pressed again after a lost response inserts the same row.
    const signature = sendSignature({ scope: `${threadId}${standalone ? " standalone" : ""}`, body, from: fromAddress, to: copies?.to, cc: copies?.cc, files: files.length, draftId });
    const key = sendKeysRef.current.begin(signature);
    if (key.busy) return false; // the same message is being queued already (a double click)
    const outboxId = key.id;
    const attachments = files.length ? pendingAttachments(files) : undefined;
    const dropPlaceholder = () => setPending((p) => p.filter((x) => x.id !== outboxId));
    if (sealed !== null && addresses !== null) setPending((p) => (p.some((x) => x.id === outboxId) ? p : [...p, { id: outboxId, threadId, body, createdAt: new Date().toISOString(), status: "queued", attachments, fromAddress, copies, fileCount: files.length }]));
    const { data, error } = sealed === null || addresses === null ? { data: null, error: true } : await insertOnce<{ id: string; created_at: string }>(
      () => supabase.from("outbox")
        .insert({ id: outboxId, thread_id: threadId, body: sealed, draft_id: draftId, from_address: addresses[0], reply_to_message_id: replyToId, attachment_count: files.length,
          // Reply All: the worker sends to exactly these. Sealed like any address.
          ...(copies ? { to_addresses: addresses[1] ?? [], cc_addresses: addresses[2] ?? [] } : {}) })
        .select("id, created_at").single(),
      () => supabase.from("outbox").select("id, created_at").eq("id", outboxId).maybeSingle(),
    );
    // Settled once the row is known to exist; a failed insert keeps the id for the next try.
    sendKeysRef.current.end(signature, !!data);
    if (error || !data) {
      dropPlaceholder();
      toast("Could not send. Your reply is still in the box.");
      return false;
    }
    if (!(await attachToOutbox(data.id, files).catch(() => false))) {
      dropPlaceholder();
      toast("Could not attach the files. Your reply is still in the box.");
      return false;
    }
    if (!standalone) {
      const t = threadMapRef.current.get(threadId);
      if (t) {
        const hours = t.lastFromMe ? 0 : Math.round(Math.max(0, (Date.now() - Date.parse(t.lastMessageAt)) / 3_600_000));
        track("reply_sent", { channel: t.channel, was_needs_reply: t.needsReply, priority: t.priority, category: t.category, hours_to_reply: hours });
        const draft = t.draft;
        if (draft && draftId) {
          const asked = draftAskRef.current[threadId];
          track("draft_sent", {
            ...draftEdit(draft.body, body),
            channel: t.channel,
            tone: draft.tone,
            secs_to_send: Math.round(Math.max(0, (Date.now() - Date.parse(draft.generatedAt)) / 1000)),
            regenerated: Math.max(0, (asked ?? 1) - 1),
            auto: !!draft.auto,
          });
          delete draftAskRef.current[threadId];
        }
      }
    }
    // The server's clock decides when the reply was made, as the imported copy is compared with it.
    setPending((p) => p.map((x) => (x.id === data.id ? { ...x, createdAt: data.created_at } : x)));
    if (draftId) rawDispatch({ type: "setDraft", id: threadId });
    if (replyToId) setReplyTo(threadId, null);
    return true;
  }, [setReplyTo]);

  // Retry of a failed send that definitely did not go out: queued again as a new row with the same text, From address and
  // Reply All recipients, and the failed one leaves. A failure that may have gone out is refused here as well as hidden in the UI.
  const retryPending = useCallback(async (outboxId: string) => {
    const p = pendingRef.current.find((x) => x.id === outboxId);
    if (!p || p.status !== "failed" || sendRecovery(p.error, p.fileCount ?? p.attachments?.length ?? 0) !== "retry") return false;
    if (!(await send(p.threadId, p.body, p.fromAddress, [], true, p.copies))) return false;
    removePending(outboxId);
    return true;
  }, [send, removePending]);

  // A new email has no conversation yet. The worker sets thread_id once the sent copy is stored.
  const composeEmail = useCallback(async (email: NewEmail) => {
    const files = email.files ?? [];
    // Sealing and address sealing can fail on a transient key error: that is a failed send, not a crash.
    const sealed = await Promise.all([seal(FIELD.subject, email.subject.trim() || null), seal(FIELD.body, email.body)]).catch(() => null);
    const addresses = sealed === null ? null : await Promise.all([
      email.fromAddress ? sealAddress(email.fromAddress) : Promise.resolve(email.fromAddress),
      Promise.all(email.to.map((a) => sealAddress(a))),
      Promise.all((email.cc ?? []).map((a) => sealAddress(a))),
      Promise.all((email.bcc ?? []).map((a) => sealAddress(a))),
    ]).catch(() => null);
    // One id per unsettled email, so pressing Send again after a lost answer cannot queue it twice.
    const signature = sendSignature({ scope: `email ${email.accountId}`, body: email.body, from: email.fromAddress, to: email.to, cc: email.cc, bcc: email.bcc, subject: email.subject, files: files.length, draftId: email.draftId });
    const key = sendKeysRef.current.begin(signature);
    if (key.busy) return null;
    const { data, error } = sealed === null || addresses === null ? { data: null, error: true } : await insertOnce<{ id: string }>(
      () => supabase.from("outbox")
        .insert({
          id: key.id,
          account_id: email.accountId,
          from_address: addresses[0],
          to_addresses: addresses[1],
          cc_addresses: addresses[2],
          bcc_addresses: addresses[3],
          subject: sealed[0],
          body: sealed[1],
          attachment_count: files.length,
          draft_id: email.draftId ?? null,
        })
        .select("id").single(),
      () => supabase.from("outbox").select("id").eq("id", key.id).maybeSingle(),
    );
    sendKeysRef.current.end(signature, !!data);
    if (error || !data) {
      toast("Could not send. Your email is still in the box.");
      return null;
    }
    if (!(await attachToOutbox(data.id, files).catch(() => false))) {
      toast("Could not attach the files. Your email is still in the box.");
      return null;
    }
    setComposed((c) => ({ ...c, [data.id]: { status: "queued" } }));
    return data.id;
  }, []);

  // A new WhatsApp chat: one number, no subject or From address. The worker sets thread_id once it is sent.
  const composeWhatsApp = useCallback(async (accountId: string, to: string, body: string, draftId?: string) => {
    const sealed = await seal(FIELD.body, body).catch(() => null);
    const sealedTo = await sealAddress(to).catch(() => null);
    const signature = sendSignature({ scope: `whatsapp ${accountId}`, body, to: [to], draftId });
    const key = sendKeysRef.current.begin(signature);
    if (key.busy) return null;
    const { data, error } = sealed === null || sealedTo === null ? { data: null, error: true } : await insertOnce<{ id: string }>(
      () => supabase.from("outbox")
        .insert({ id: key.id, account_id: accountId, to_addresses: [sealedTo], body: sealed, attachment_count: 0, draft_id: draftId ?? null })
        .select("id").single(),
      () => supabase.from("outbox").select("id").eq("id", key.id).maybeSingle(),
    );
    sendKeysRef.current.end(signature, !!data);
    if (error || !data) {
      toast("Could not send. Your message is still in the box.");
      return null;
    }
    setComposed((c) => ({ ...c, [data.id]: { status: "queued" } }));
    return data.id;
  }, []);

  const refreshCompose = useCallback(async (outboxId: string) => {
    const { data } = await supabase.from("outbox").select("status, thread_id, error").eq("id", outboxId).maybeSingle();
    if (data) setComposed((c) => ({ ...c, [outboxId]: composeStatusOf(data) }));
  }, []);

  // Only send_addresses is writable by the app; the database lowercases and dedupes the list.
  const saveSendAddresses = useCallback(async (accountId: string, addresses: string[]) => {
    const before = stateRef.current.accounts.find((a) => a.id === accountId)?.sendAddresses ?? [];
    rawDispatch({ type: "patchAccount", id: accountId, patch: { sendAddresses: addresses } });
    const unique = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))];
    const { error } = await supabase.from("accounts").update({ send_addresses: await Promise.all(unique.map((a) => sealAddress(a))) }).eq("id", accountId);
    if (error) {
      rawDispatch({ type: "patchAccount", id: accountId, patch: { sendAddresses: before } });
      saveFailed();
      return false;
    }
    return true;
  }, [saveFailed]);

  return { removePending, replyTo, setReplyTo, send, retryPending, composeEmail, composeWhatsApp, refreshCompose, saveSendAddresses };
}
