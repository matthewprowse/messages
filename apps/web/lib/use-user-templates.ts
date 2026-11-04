"use client";

// Your own templates and snippets (user_templates), opened in the browser and shared through a module-level cache so the reply
// box, New Email and Settings agree. Title and shortcut are sealed as writingSituation and the body as writingBody, the nearest
// existing fields; the AI worker never opens them. A template is picked from a menu, a snippet is typed as ;shortcut.
// The reply box and the reply header mount together: they share one read (lib/memory-cache.ts), done again on a new
// sign-in or when a mount finds it older than TEMPLATES_FRESH_MS.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open, seal } from "./vault";
import { normaliseShortcut } from "./snippets";
import { createMemoryCache } from "./memory-cache";

export const TEMPLATE_LIMITS = { title: 80, body: 2000, count: 100 };

export interface UserTemplate {
  id: string;
  kind: "template" | "snippet";
  title: string;
  /** Lowercase, without the semicolon. Snippets only. */
  shortcut: string;
  body: string;
}

/** Templates change here or in Settings, rarely elsewhere: a mount reads again only when the copy is older than this. */
const TEMPLATES_FRESH_MS = 10 * 60_000;
const NONE: UserTemplate[] = [];
// By user id. The text is opened here: memory only, emptied on sign out.
const templates = createMemoryCache<UserTemplate[]>({ max: 1 });

async function load(): Promise<UserTemplate[]> {
  const { data, error } = await supabase.from("user_templates").select("id, kind, title, shortcut, body").order("position").order("created_at");
  if (error) throw new Error(`Load templates failed (${error.code})`);
  return Promise.all((data ?? []).map(async (r) => ({
    id: r.id,
    kind: r.kind === "snippet" ? "snippet" as const : "template" as const,
    title: (await open(FIELD.writingSituation, r.title)) ?? "",
    shortcut: (await open(FIELD.writingSituation, r.shortcut)) ?? "",
    body: (await open(FIELD.writingBody, r.body)) ?? "",
  })));
}

/** Your templates and snippets, with add, change and remove. Each shows at once and is put back when the save fails. */
export function useUserTemplates() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const items = useSyncExternalStore(templates.subscribe, () => (userId ? templates.get(userId) : undefined) ?? NONE, () => NONE);
  useEffect(() => {
    if (userId) templates.load(userId, load, TEMPLATES_FRESH_MS).catch(() => {});
  }, [userId]);

  /** Adds (no id) or changes one. Returns a reason on failure, null when it worked. */
  const save = useCallback(async (item: { id?: string; kind: UserTemplate["kind"]; title: string; shortcut?: string; body: string }): Promise<string | null> => {
    if (!userId) return "Sign in again to save.";
    const clean: UserTemplate = { id: item.id ?? crypto.randomUUID(), kind: item.kind, title: item.title.trim().slice(0, TEMPLATE_LIMITS.title), shortcut: item.kind === "snippet" ? normaliseShortcut(item.shortcut ?? "") : "", body: item.body.trim().slice(0, TEMPLATE_LIMITS.body) };
    if (!clean.title || !clean.body) return "Give it a name and some text.";
    const cache = templates.get(userId) ?? NONE;
    if (clean.kind === "snippet" && !clean.shortcut) return "Give the snippet a shortcut of letters and numbers.";
    if (clean.kind === "snippet" && cache.some((t) => t.kind === "snippet" && t.shortcut === clean.shortcut && t.id !== clean.id)) return "Another snippet already uses that shortcut.";
    const exists = cache.some((t) => t.id === clean.id);
    if (!exists && cache.length >= TEMPLATE_LIMITS.count) return `You can keep up to ${TEMPLATE_LIMITS.count}. Remove one first.`;
    const before = cache;
    templates.set(userId, exists ? cache.map((t) => (t.id === clean.id ? clean : t)) : [...cache, clean]);
    try {
      const { error } = await supabase.from("user_templates").upsert({
        id: clean.id, user_id: userId, kind: clean.kind,
        title: await seal(FIELD.writingSituation, clean.title),
        shortcut: clean.shortcut ? await seal(FIELD.writingSituation, clean.shortcut) : null,
        body: await seal(FIELD.writingBody, clean.body),
        ...(exists ? {} : { position: before.length }),
      }, { onConflict: "id" });
      if (error) throw error;
      return null;
    } catch {
      templates.set(userId, before);
      return "Could not save. Try again.";
    }
  }, [userId]);

  /** Removes one. False when the removal failed and it is back. */
  const remove = useCallback(async (id: string): Promise<boolean> => {
    if (!userId) return false;
    const before = templates.get(userId) ?? NONE;
    templates.set(userId, before.filter((t) => t.id !== id));
    const { error } = await supabase.from("user_templates").delete().eq("id", id);
    if (error) { templates.set(userId, before); return false; }
    return true;
  }, [userId]);

  return { items, save, remove };
}
