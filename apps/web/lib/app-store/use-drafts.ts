// Asking the AI worker for drafts: a reply draft for a conversation, a draft for a new message, and throwing them
// away. The worker writes the draft; it comes back through Realtime (use-realtime.ts).

import { useCallback } from "react";
import { toast } from "sonner";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "../supabase";
import { seal } from "../vault";
import { track } from "../analytics";
import type { Decision, Draft, Thread } from "../types";
import { ComposeDraft, ComposeDraftRequest } from "./compose";
import { DraftPhase } from "./context";
import { DRAFT_TIMEOUT_MS, VOICE_DRAFT_TIMEOUT_MS, uploadRecording } from "./draft-helpers";
import type { Action } from "./reducer";

export interface DraftDeps {
  userId: string | null;
  rawDispatch: React.Dispatch<Action>;
  threadMapRef: React.MutableRefObject<Map<string, Thread>>;
  draftAskRef: React.MutableRefObject<Record<string, number | undefined>>;
  draftWaitRef: React.MutableRefObject<Record<string, string | undefined>>;
  composeWaitRef: React.MutableRefObject<Set<string>>;
  setDrafting: React.Dispatch<React.SetStateAction<Record<string, DraftPhase | undefined>>>;
  setComposeDrafts: React.Dispatch<React.SetStateAction<Record<string, ComposeDraft | undefined>>>;
  saveFailed: () => void;
}

/** The drafting actions of the context. */
export function useDrafts({ userId, rawDispatch, threadMapRef, draftAskRef, draftWaitRef, composeWaitRef, setDrafting, setComposeDrafts, saveFailed }: DraftDeps) {
  // The AI worker writes the draft; it arrives through Realtime, usually within a few seconds. One that
  // has not arrived after DRAFT_TIMEOUT_MS is given up on, so the composer never waits forever.
  const generateDraft = useCallback(async (threadId: string, tone: Draft["tone"] = "default", instruction?: string, decision?: Decision, source?: string, audio?: Blob) => {
    if (!userId) return;
    const asking = threadMapRef.current.get(threadId);
    draftAskRef.current[threadId] = (draftAskRef.current[threadId] ?? 0) + 1;
    if (asking) track("draft_requested", { tone, source: decision ? "choice" : "manual", channel: asking.channel, has_instruction: !!instruction?.trim() || !!audio, revises: source !== undefined, via: audio ? "voice" : instruction?.trim() ? "typed" : undefined });
    setDrafting((d) => ({ ...d, [threadId]: "thinking" }));
    // A recording goes up sealed with your key first; the worker deletes it once the draft is written.
    const audioPath = audio ? await uploadRecording(userId, audio) : undefined;
    if (audio && !audioPath) {
      setDrafting((d) => ({ ...d, [threadId]: undefined }));
      toast("Could not send the recording. Check your connection and try again.");
      return;
    }
    const { data, error } = await supabase
      .from("drafts")
      .insert({
        user_id: userId, thread_id: threadId, tone, instruction: await seal(FIELD.instruction, instruction?.trim() || null), status: "pending",
        // Only sent with a choice, so drafts keep working where the decision columns are not there yet.
        ...(decision ? { decision: await seal(FIELD.instruction, decision.text), decision_kind: decision.kind } : {}),
        ...(source !== undefined ? { source: await seal(FIELD.draft, source) } : {}),
        ...(audioPath ? { audio_path: audioPath } : {}),
      })
      .select("id")
      .single();
    if (error || !data) {
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
      setDrafting((d) => ({ ...d, [threadId]: undefined }));
      toast(tone === "edit" ? "Could not ask for an edit. Check your connection and try again." : "Could not ask for a draft. Check your connection and try again.");
      return;
    }
    draftWaitRef.current[threadId] = data.id;
    setTimeout(() => {
      if (draftWaitRef.current[threadId] !== data.id) return;
      delete draftWaitRef.current[threadId];
      setDrafting((d) => ({ ...d, [threadId]: undefined }));
      toast(tone === "edit" ? "The edit took too long. Try again." : "The draft took too long. Try again.");
      // Withdrawn, so the AI worker does not pick it up later. A Supabase query only runs once awaited.
      void supabase.from("drafts").update({ status: "discarded" }).eq("id", data.id).eq("status", "pending").then(() => undefined);
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
    }, audio ? VOICE_DRAFT_TIMEOUT_MS : DRAFT_TIMEOUT_MS);
  }, [userId]);

  // A new message's draft: the same pending row and AI worker, with no conversation. It comes back
  // through Realtime into composeDrafts; one not back after the timeout is given up on and withdrawn.
  const generateComposeDraft = useCallback(async (req: ComposeDraftRequest) => {
    if (!userId) return null;
    const tone = req.tone ?? "custom";
    const instruction = req.instruction?.trim() || undefined;
    track("draft_requested", { tone, source: "compose", channel: req.channel, has_instruction: !!instruction || !!req.audio, revises: req.source !== undefined, via: req.audio ? "voice" : instruction ? "typed" : undefined });
    const audioPath = req.audio ? await uploadRecording(userId, req.audio) : undefined;
    if (req.audio && !audioPath) {
      toast("Could not send the recording. Check your connection and try again.");
      return null;
    }
    const { data, error } = await supabase
      .from("drafts")
      .insert({
        user_id: userId, thread_id: null, account_id: req.accountId, contact_id: req.contactId ?? null, tone, status: "pending",
        instruction: await seal(FIELD.instruction, instruction ?? null),
        ...(req.source !== undefined ? { source: await seal(FIELD.draft, req.source) } : {}),
        ...(audioPath ? { audio_path: audioPath } : {}),
      })
      .select("id")
      .single();
    if (error || !data) {
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
      toast("Could not ask for a draft. Check your connection and try again.");
      return null;
    }
    composeWaitRef.current.add(data.id);
    setComposeDrafts((c) => ({ ...c, [data.id]: { status: "pending" } }));
    setTimeout(() => {
      if (!composeWaitRef.current.delete(data.id)) return;
      setComposeDrafts((c) => ({ ...c, [data.id]: { status: "failed", error: "The draft took too long. Try again." } }));
      void supabase.from("drafts").update({ status: "discarded" }).eq("id", data.id).eq("status", "pending").then(() => undefined);
      if (audioPath) void supabase.storage.from("attachments").remove([audioPath]).then(() => undefined);
    }, req.audio ? VOICE_DRAFT_TIMEOUT_MS : DRAFT_TIMEOUT_MS);
    return data.id;
  }, [userId]);

  const discardComposeDraft = useCallback((id: string, status: "discarded" | "revised" = "discarded") => {
    composeWaitRef.current.delete(id);
    setComposeDrafts((c) => { const next = { ...c }; delete next[id]; return next; });
    void supabase.from("drafts").update({ status }).eq("id", id).in("status", ["pending", "active"]).then(() => undefined);
  }, []);

  const discardDraft = useCallback((threadId: string) => {
    const t = threadMapRef.current.get(threadId);
    const draft = t?.draft;
    if (t && draft) track("draft_discarded", { channel: t.channel, tone: draft.tone, secs: Math.round(Math.max(0, (Date.now() - Date.parse(draft.generatedAt)) / 1000)), auto: !!draft.auto });
    rawDispatch({ type: "setDraft", id: threadId });
    if (draft) supabase.from("drafts").update({ status: "discarded" }).eq("id", draft.id).then(({ error }) => { if (error) saveFailed(); });
  }, [saveFailed]);

  return { generateDraft, generateComposeDraft, discardComposeDraft, discardDraft };
}
