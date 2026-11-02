"use client";

// Which labels are Auto and what each one's description says, read from the labels table when Manage Labels opens and
// saved as it changes (a failure puts it back with a toast). Descriptions are sealed like label names (field "name").
// Kept apart from use-labels.ts, which holds the labels themselves.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FIELD } from "@messages/crypto/fields";
import { AUTO_MAX, canTurnOn, cleanDescription, type AutoSetting } from "@/lib/auto-labels";
import { supabase } from "@/lib/supabase";
import { open, seal } from "@/lib/vault";

export function useAutoLabels(active: boolean) {
  const [settings, setSettings] = useState<Map<string, AutoSetting>>(new Map());
  const latest = useRef(settings);
  latest.current = settings;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("labels").select("id, auto, auto_description");
      if (error || !data || cancelled) return; // before the migration is applied there is nothing to show
      const next = new Map<string, AutoSetting>();
      for (const r of data) next.set(r.id, { auto: r.auto, description: (await open(FIELD.name, r.auto_description)) ?? "" });
      if (!cancelled) setSettings(next);
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [active]);

  /** Saves a label's Auto switch and description. Resolves false when it could not be turned on or saved. */
  const save = useCallback(async (labelId: string, auto: boolean, rawDescription: string) => {
    const description = cleanDescription(rawDescription);
    const before = latest.current;
    if (auto && (!description || !canTurnOn(before, labelId))) {
      if (auto && description) toast(`At most ${AUTO_MAX} labels can be Auto.`);
      return false;
    }
    setSettings((m) => new Map(m).set(labelId, { auto, description }));
    try {
      const { error } = await supabase.from("labels").update({ auto, auto_description: description ? await seal(FIELD.name, description) : null }).eq("id", labelId);
      if (error) throw error;
      return true;
    } catch {
      setSettings(before);
      toast("Could not save that. Try again.");
      return false;
    }
  }, []);

  return { settings, save };
}
