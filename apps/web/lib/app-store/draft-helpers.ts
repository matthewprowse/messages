// Draft timeouts and the pre-draft check for the app store (store.tsx). Holds the voice-instruction upload; it does not
// call the AI worker itself.


import type { Profile, Thread } from "../types";
import { supabase } from "../supabase";
import { userKeys } from "../vault";
import { encryptBytes } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";

/** How long the composer waits for an AI draft before giving up. */
export const DRAFT_TIMEOUT_MS = 30_000;
/** A spoken request also goes up and is listened to first. */
export const VOICE_DRAFT_TIMEOUT_MS = 45_000;

/** A recording of what a draft should say, sealed with your key and uploaded where only you and the AI
 *  worker can read it. Its path, or undefined when it could not be uploaded. */
export async function uploadRecording(userId: string, audio: Blob): Promise<string | undefined> {
  const ext = audio.type.startsWith("audio/ogg") ? "ogg" : audio.type.startsWith("audio/mp4") ? "m4a" : "webm";
  const path = `${userId}/drafts/${crypto.randomUUID()}.${ext}`;
  try {
    const sealed = await encryptBytes(await userKeys(), FIELD.voiceInstruction, new Uint8Array(await audio.arrayBuffer()));
    const { error } = await supabase.storage.from("attachments").upload(path, new Blob([sealed], { type: "application/octet-stream" }), { contentType: "application/octet-stream" });
    return error ? undefined : path;
  } catch {
    return undefined;
  }
}
/** How long a conversation stays quiet before it gets a pre-draft, so a burst of messages gets one. */
export const PRE_DRAFT_QUIET_MS = 30_000;
/** Conversations older than this many days are not pre-drafted. */
export const PRE_DRAFT_DAYS = 7;

/** Whether a conversation might get a pre-draft (docs/PLAN.md, Pre-Drafting). The database decides, in
 *  request_auto_draft; this only saves asking about conversations that plainly do not qualify. */
export function mayPreDraft(t: Thread, profile: Profile): boolean {
  const person = t.needsReply || t.category === "personal" || t.category === "work" || t.category === "needs_reply";
  const draftSince = !!t.draft && Date.parse(t.draft.generatedAt) > Date.parse(t.lastMessageAt);
  return profile.autoDraftTop && person && !t.isGroup && !t.junk && !t.lastFromMe && !draftSince && t.status !== "trash"
    && Date.now() - Date.parse(t.lastMessageAt) < PRE_DRAFT_DAYS * 86_400_000;
}
