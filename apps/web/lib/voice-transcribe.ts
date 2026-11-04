"use client";

// Transcribe on a voice note the AI worker held back: one from a conversation you have never written in waits ('deferred',
// migration 20261124120000) so strangers cannot spend your AI allowance. Asking marks it 'requested' through
// request_transcription (migration 20261124150000), which the worker takes without deferring it again (the bubble shows
// Transcribing meanwhile, map-message.ts transcriptFlags); the transcript then arrives over Realtime like any other.

import { supabase } from "./supabase";

/** Asks for this voice note to be transcribed. Resolves to an error sentence, or null (also when it was already queued or done). */
export async function requestTranscription(messageId: string): Promise<string | null> {
  const { error } = await supabase.rpc("request_transcription", { p_message: messageId });
  return error ? "Could not ask for a transcript. Try again." : null;
}
