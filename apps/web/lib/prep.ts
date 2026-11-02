// Loads the sealed client card and meeting briefs the AI worker writes (client_cards, event_preps) and opens them
// in the browser. The worker owns every write; the only thing the app does is ask for a card refresh, through
// a database function that enforces the daily cap.

import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { open } from "./vault";
import { parsePrep, refreshPending, refreshesLeft, type PrepPerson } from "./prep-text";

export type ClientCardState = { card: string | null; updatedAt: string | null; pending: boolean; left: number };

/** A contact's card, when it was written, whether a refresh is on its way and how many are left today. */
export async function loadClientCard(contactId: string): Promise<ClientCardState> {
  const { data, error } = await supabase
    .from("client_cards")
    .select("card, updated_at, requested_at, refresh_day, refresh_count")
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error) throw new Error(`Load client card failed (${error.code})`);
  return {
    card: (await open(FIELD.contactSummary, data?.card)) || null,
    updatedAt: data?.updated_at ?? null,
    pending: refreshPending(data ?? null),
    left: refreshesLeft(data ?? null),
  };
}

/** Asks for a fresh card. Returns the refreshes left today, or null when none could be asked for. */
export async function requestCardRefresh(contactId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc("request_client_card_refresh", { p_contact: contactId });
  if (error || typeof data !== "number" || data < 0) return null;
  return data;
}

/** The brief for one event, or none when it has not been prepared (no known guests, or more than 30 minutes away). */
export async function loadEventPrep(eventId: string): Promise<PrepPerson[]> {
  const { data, error } = await supabase.from("event_preps").select("brief").eq("event_id", eventId).maybeSingle();
  if (error) throw new Error(`Load meeting prep failed (${error.code})`);
  return parsePrep(await open(FIELD.summary, data?.brief));
}

/** Which of these events have a brief, so the Summary can show a Prep link only where there is one. */
export async function loadPreppedEvents(eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const { data, error } = await supabase.from("event_preps").select("event_id").in("event_id", eventIds.slice(0, 100));
  if (error) throw new Error(`Load meeting prep failed (${error.code})`);
  return new Set(data.map((r) => r.event_id));
}
