// Answering an invitation: queues the calendar_updates row and waits for the worker to settle it. The one path the
// Calendar page's Reply buttons and the invitation card in a conversation both use, so an answer is made the same way
// from either. The caller shows the answer meanwhile, using `onSaved` for the row's id.

import { buildResponse, followUpdate, type CalendarEvent, type EventResponse, type UpdateResult, type UpdateScope } from "./calendar";
import { supabase } from "./supabase";

export type AnswerOutcome = { saved: false } | ({ saved: true; token: string } & UpdateResult);

/** Queues an answer (to the whole series when `scope` says so) and resolves once the worker has made it, refused it or not answered in a minute. */
export async function sendAnswer(event: CalendarEvent, response: EventResponse, scope: UpdateScope = "occurrence", onSaved?: (token: string) => void): Promise<AnswerOutcome> {
  const { data, error } = await supabase.from("calendar_updates").insert(buildResponse(event, response, scope)).select("id").single();
  if (error || !data) return { saved: false };
  onSaved?.(data.id);
  return { saved: true, token: data.id, ...(await followUpdate(data.id)) };
}
