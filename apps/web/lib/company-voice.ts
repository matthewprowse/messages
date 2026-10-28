"use client";

// The team's company voice (supabase/migrations/20261104100000_team_after_launch.sql), from the app's side: how the business
// writes (tone, sign-off, things to always and never say), templates (a name and a body) and company facts (a title and a
// body). Everything is sealed with the team's key here in the browser, so the server never holds a readable word of it.
// Every active member reads it (templates go into the composer); only an owner or admin saves it, through the database
// functions. The AI worker reads it for a draft in a work chat and never for a personal one (apps/ai/ai/company_voice.py);
// the field names below are the ones it opens each part with.

import { useCallback, useEffect, useMemo, useState } from "react";
import { encryptTeamField } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open, teamKeys } from "./vault";

const problem = (error: { message: string } | null) => error?.message || "Something went wrong. Try again.";

/** How the business writes, one row each. */
export type ProfileSlot = "tone" | "sign_off" | "always" | "never";

export const PROFILE_PARTS: { slot: ProfileSlot; label: string; hint: string; lines: boolean; max: number; placeholder: string }[] = [
  { slot: "tone", label: "Tone", hint: "How the business sounds.", lines: false, max: 600, placeholder: "Warm and plain. Never pushy." },
  { slot: "sign_off", label: "Sign-Off", hint: "How a message ends, when the person writing has no habit of their own.", lines: false, max: 600, placeholder: "Kind regards, Acme Properties" },
  { slot: "always", label: "Always Say", hint: "One a line. Said whenever a reply calls for it, such as a licence number or a disclaimer.", lines: true, max: 2400, placeholder: "Our FSP number is 12345" },
  { slot: "never", label: "Never Say", hint: "One a line. Things no reply from the business should say.", lines: true, max: 2400, placeholder: "Promise a price before a viewing" },
];

// Limits of what the AI reads of each (company_voice.py): the rest is kept and shown but not sent with a draft.
export const LIMITS = { name: 80, template: 2000, templateRead: 600, factTitle: 80, fact: 500 };

const FIELDS = {
  profile: { body: FIELD.styleRule },
  template: { title: FIELD.writingSituation, body: FIELD.writingBody },
  fact: { title: FIELD.noteTitle, body: FIELD.note },
} as const satisfies Record<string, Partial<Record<"title" | "body", Field>>>;

export interface VoiceItem {
  id: string;
  title: string;
  body: string;
}

export interface CompanyVoice {
  profile: Record<ProfileSlot, { id: string | null; text: string }>;
  templates: VoiceItem[];
  facts: VoiceItem[];
}

const emptyProfile = (): CompanyVoice["profile"] => ({ tone: { id: null, text: "" }, sign_off: { id: null, text: "" }, always: { id: null, text: "" }, never: { id: null, text: "" } });

/** The workspace's company voice, opened with the team's key. undefined while loading, null when it failed. */
export function useCompanyVoice(enabled = true) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [voice, setVoice] = useState<CompanyVoice | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!userId || !enabled) return;
    const { data, error } = await supabase.from("workspace_voice_items").select("id, kind, slot, title, body, position, created_at").order("position").order("created_at");
    if (error) return setVoice(null);
    const next: CompanyVoice = { profile: emptyProfile(), templates: [], facts: [] };
    for (const r of data ?? []) {
      if (r.kind === "profile") {
        const slot = r.slot as ProfileSlot;
        if (slot in next.profile) next.profile[slot] = { id: r.id, text: (await open(FIELDS.profile.body, r.body)) ?? "" };
      } else if (r.kind === "template") {
        next.templates.push({ id: r.id, title: (await open(FIELDS.template.title, r.title)) ?? "", body: (await open(FIELDS.template.body, r.body)) ?? "" });
      } else if (r.kind === "fact") {
        next.facts.push({ id: r.id, title: (await open(FIELDS.fact.title, r.title)) ?? "", body: (await open(FIELDS.fact.body, r.body)) ?? "" });
      }
    }
    setVoice(next);
  }, [userId, enabled]);

  useEffect(() => { void load(); }, [load]);
  return useMemo(() => ({ voice, reload: load }), [voice, load]);
}

async function sealed(field: Field, text: string): Promise<string> {
  const team = await teamKeys();
  if (!team) throw new Error("no team key");
  return encryptTeamField(team, field, text);
}

const NO_KEY = "Your team's key is not available. Reload the page and try again.";

/** Saves one part of the profile. Blank text removes it. Returns a reason on failure, null when it worked. */
export async function saveProfilePart(slot: ProfileSlot, existingId: string | null, text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) {
    if (!existingId) return null;
    const { error } = await supabase.rpc("delete_voice_item", { p_id: existingId });
    return error ? problem(error) : null;
  }
  try {
    const { error } = await supabase.rpc("save_voice_item", { p_id: null, p_kind: "profile", p_slot: slot, p_title: null, p_body: await sealed(FIELDS.profile.body, trimmed) });
    return error ? problem(error) : null;
  } catch {
    return NO_KEY;
  }
}

/** Adds or changes a template or a company fact. id null adds one. Returns a reason on failure, null when it worked. */
export async function saveVoiceItem(kind: "template" | "fact", id: string | null, title: string, body: string): Promise<string | null> {
  try {
    const f = FIELDS[kind];
    const { error } = await supabase.rpc("save_voice_item", { p_id: id, p_kind: kind, p_slot: null, p_title: await sealed(f.title, title.trim()), p_body: await sealed(f.body, body.trim()) });
    return error ? problem(error) : null;
  } catch {
    return NO_KEY;
  }
}

export async function deleteVoiceItem(id: string): Promise<string | null> {
  const { error } = await supabase.rpc("delete_voice_item", { p_id: id });
  return error ? problem(error) : null;
}

let cachedTemplates: { user: string; at: number; templates: VoiceItem[] } | null = null;
const TEMPLATES_TTL_MS = 60_000;

/**
 * The team's templates for the composer, opened and kept for a minute, so moving between chats does not read them again.
 * Empty when not enabled (a chat that is not a work chat), when the person has no team or when it could not be read.
 */
export function useTemplates(enabled: boolean): VoiceItem[] {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [templates, setTemplates] = useState<VoiceItem[]>(() => (userId && cachedTemplates?.user === userId ? cachedTemplates.templates : []));
  useEffect(() => {
    if (!enabled || !userId) return;
    if (cachedTemplates?.user === userId && Date.now() - cachedTemplates.at < TEMPLATES_TTL_MS) return void setTemplates(cachedTemplates.templates);
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.from("workspace_voice_items").select("id, title, body").eq("kind", "template").order("position").order("created_at");
      if (error || !alive) return;
      const rows = await Promise.all((data ?? []).map(async (r): Promise<VoiceItem> => ({ id: r.id, title: (await open(FIELDS.template.title, r.title)) ?? "", body: (await open(FIELDS.template.body, r.body)) ?? "" })));
      const usable = rows.filter((r) => r.title && r.body);
      cachedTemplates = { user: userId, at: Date.now(), templates: usable };
      if (alive) setTemplates(usable);
    })();
    return () => { alive = false; };
  }, [enabled, userId]);
  return enabled ? templates : [];
}
