"use client";

// Your own templates and snippets (user_templates), opened in the browser and shared through a module-level cache so the reply
// box, New Email and Settings agree. Title and shortcut are sealed as writingSituation and the body as writingBody, the nearest
// existing fields; the AI worker never opens them. A template is picked from a menu, a snippet is typed as ;shortcut.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open, seal } from "./vault";
import { normaliseShortcut } from "./snippets";

export const TEMPLATE_LIMITS = { title: 80, body: 2000, count: 100 };

export interface UserTemplate {
  id: string;
  kind: "template" | "snippet";
  title: string;
  /** Lowercase, without the semicolon. Snippets only. */
  shortcut: string;
  body: string;
}

let cache: UserTemplate[] = [];
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

async function load(userId: string) {
  const { data, error } = await supabase.from("user_templates").select("id, kind, title, shortcut, body").order("position").order("created_at");
  if (error) return;
  const rows = await Promise.all((data ?? []).map(async (r) => ({
    id: r.id,
    kind: r.kind === "snippet" ? "snippet" as const : "template" as const,
    title: (await open(FIELD.writingSituation, r.title)) ?? "",
    shortcut: (await open(FIELD.writingSituation, r.shortcut)) ?? "",
    body: (await open(FIELD.writingBody, r.body)) ?? "",
  })));
  cache = rows;
  loadedFor = userId;
  emit();
}

/** Your templates and snippets, with add, change and remove. Each shows at once and is put back when the save fails. */
export function useUserTemplates() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const items = useSyncExternalStore(subscribe, () => cache, () => cache);
  useEffect(() => {
    if (!userId) { cache = []; loadedFor = null; emit(); return; }
    if (loadedFor !== userId) void load(userId);
  }, [userId]);

  /** Adds (no id) or changes one. Returns a reason on failure, null when it worked. */
  const save = useCallback(async (item: { id?: string; kind: UserTemplate["kind"]; title: string; shortcut?: string; body: string }): Promise<string | null> => {
    if (!userId) return "Sign in again to save.";
    const clean: UserTemplate = { id: item.id ?? crypto.randomUUID(), kind: item.kind, title: item.title.trim().slice(0, TEMPLATE_LIMITS.title), shortcut: item.kind === "snippet" ? normaliseShortcut(item.shortcut ?? "") : "", body: item.body.trim().slice(0, TEMPLATE_LIMITS.body) };
    if (!clean.title || !clean.body) return "Give it a name and some text.";
    if (clean.kind === "snippet" && !clean.shortcut) return "Give the snippet a shortcut of letters and numbers.";
    if (clean.kind === "snippet" && cache.some((t) => t.kind === "snippet" && t.shortcut === clean.shortcut && t.id !== clean.id)) return "Another snippet already uses that shortcut.";
    const exists = cache.some((t) => t.id === clean.id);
    if (!exists && cache.length >= TEMPLATE_LIMITS.count) return `You can keep up to ${TEMPLATE_LIMITS.count}. Remove one first.`;
    const before = cache;
    cache = exists ? cache.map((t) => (t.id === clean.id ? clean : t)) : [...cache, clean];
    emit();
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
      cache = before;
      emit();
      return "Could not save. Try again.";
    }
  }, [userId]);

  /** Removes one. False when the removal failed and it is back. */
  const remove = useCallback(async (id: string): Promise<boolean> => {
    const before = cache;
    cache = cache.filter((t) => t.id !== id);
    emit();
    const { error } = await supabase.from("user_templates").delete().eq("id", id);
    if (error) { cache = before; emit(); return false; }
    return true;
  }, []);

  return { items, save, remove };
}
