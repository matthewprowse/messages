// The user's labels and the labels on each conversation: loaded once signed in, changed at once and saved after (a
// failure puts the change back with a toast). Names are the user's own text, so they are sealed with their key (field
// "name") before they are stored and opened after they are read.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FIELD } from "@messages/crypto/fields";
import { allRows } from "../contacts";
import { allWear as everyWear, cleanName, linksByThread, nameTaken, nextColor, withLabel, withoutLabel, type Label, type LabelColor } from "../labels";
import { supabase } from "../supabase";
import { open, seal } from "../vault";

export interface LabelsApi {
  labels: Label[];
  /** The labels a conversation wears, in the order they were put on. */
  labelsOf: (threadId: string) => Label[];
  /** Conversation ids that wear a label, for the label filter. */
  threadsWith: (labelId: string) => Set<string>;
  /** Whether every one of these conversations wears the label. */
  allWear: (threadIds: string[], labelId: string) => boolean;
  /** Makes a label. Resolves to it, or null when the name is empty or taken, or it could not be saved. */
  createLabel: (name: string, color?: LabelColor) => Promise<Label | null>;
  /** Renames or recolours a label. Resolves false when the name is empty or taken, or it could not be saved. */
  updateLabel: (id: string, patch: { name?: string; color?: LabelColor }) => Promise<boolean>;
  deleteLabel: (id: string) => void;
  /** Puts a label on conversations (or takes it off), with an Undo toast. */
  setLabel: (threadIds: string[], labelId: string, on: boolean) => void;
}

const NO_LABELS: Label[] = [];

export function useLabels({ userId, notify, saveFailed }: { userId: string | null; notify: (text: string, undo?: () => void) => void; saveFailed: () => void }): LabelsApi {
  const [labels, setLabels] = useState<Label[]>([]);
  const [links, setLinks] = useState<Map<string, string[]>>(new Map());
  // Read inside callbacks, so they stay stable.
  const latest = useRef({ labels, links });
  latest.current = { labels, links };

  useEffect(() => {
    if (!userId) { setLabels([]); setLinks(new Map()); return; }
    let cancelled = false;
    // Not required: without the tables (not applied yet) or a connection the inbox works, just without labels.
    (async () => {
      const [l, t] = await Promise.all([
        allRows("Load labels", (from, to) => supabase.from("labels").select("id, name, color").order("created_at").order("id").range(from, to)),
        allRows("Load thread labels", (from, to) => supabase.from("thread_labels").select("thread_id, label_id").order("thread_id").order("label_id").range(from, to)),
      ]);
      const names = await Promise.all(l.map((r) => open(FIELD.name, r.name)));
      if (cancelled) return;
      setLabels(l.map((r, i) => ({ id: r.id, name: names[i] ?? "", color: r.color as LabelColor })));
      setLinks(linksByThread(t));
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [userId]);

  const byId = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  // Built together, so a conversation that did not change keeps its array and a memoised row is not redrawn for it.
  const labelsByThread = useMemo(() => new Map([...links].map(([threadId, ids]) => [threadId, ids.flatMap((id) => byId.get(id) ?? [])] as const)), [links, byId]);
  const labelsOf = useCallback((threadId: string) => labelsByThread.get(threadId) ?? NO_LABELS, [labelsByThread]);
  const threadsWith = useCallback((labelId: string) => {
    const out = new Set<string>();
    for (const [threadId, ids] of links) if (ids.includes(labelId)) out.add(threadId);
    return out;
  }, [links]);
  const allWear = useCallback((threadIds: string[], labelId: string) => everyWear(links, threadIds, labelId), [links]);

  const createLabel = useCallback(async (raw: string, color?: LabelColor) => {
    const name = cleanName(raw);
    if (!name || nameTaken(latest.current.labels, name)) return null;
    const chosen = color ?? nextColor(latest.current.labels);
    try {
      const { data, error } = await supabase.from("labels").insert({ name: await seal(FIELD.name, name), color: chosen }).select("id").single();
      if (error || !data) { saveFailed(); return null; }
      const label: Label = { id: data.id, name, color: chosen };
      setLabels((all) => [...all, label]);
      return label;
    } catch {
      saveFailed();
      return null;
    }
  }, [saveFailed]);

  const updateLabel = useCallback(async (id: string, patch: { name?: string; color?: LabelColor }) => {
    const before = latest.current.labels.find((l) => l.id === id);
    if (!before) return false;
    const name = patch.name === undefined ? before.name : cleanName(patch.name);
    if (!name || nameTaken(latest.current.labels, name, id)) return false;
    const next: Label = { ...before, name, color: patch.color ?? before.color };
    setLabels((all) => all.map((l) => (l.id === id ? next : l)));
    try {
      const { error } = await supabase.from("labels").update({ name: await seal(FIELD.name, name), color: next.color }).eq("id", id);
      if (error) throw error;
      return true;
    } catch {
      setLabels((all) => all.map((l) => (l.id === id ? before : l)));
      saveFailed();
      return false;
    }
  }, [saveFailed]);

  const deleteLabel = useCallback((id: string) => {
    const before = latest.current;
    setLabels((all) => all.filter((l) => l.id !== id));
    setLinks((m) => withoutLabel(m, id));
    // The links go with the label (on delete cascade).
    supabase.from("labels").delete().eq("id", id).then(({ error }) => {
      if (!error) return;
      setLabels(before.labels);
      setLinks(before.links);
      saveFailed();
    });
  }, [saveFailed]);

  const setLabel = useCallback((threadIds: string[], labelId: string, on: boolean) => {
    const { links: before, labels: all } = latest.current;
    const name = all.find((l) => l.id === labelId)?.name;
    // Only the conversations that change are written.
    const changing = threadIds.filter((id) => (before.get(id)?.includes(labelId) ?? false) !== on);
    if (changing.length === 0) return;
    const write = async (ids: string[], add: boolean) => {
      const result = add
        ? await supabase.from("thread_labels").upsert(ids.map((thread_id) => ({ thread_id, label_id: labelId })), { onConflict: "thread_id,label_id", ignoreDuplicates: true })
        : await supabase.from("thread_labels").delete().eq("label_id", labelId).in("thread_id", ids);
      return !result.error;
    };
    setLinks((m) => withLabel(m, changing, labelId, on));
    write(changing, on).then((ok) => {
      if (ok) return;
      setLinks((m) => withLabel(m, changing, labelId, !on));
      saveFailed();
    });
    const n = changing.length;
    notify(on ? (n === 1 ? `Labelled ${name}` : `Labelled ${n} conversations ${name}`) : (n === 1 ? `Removed ${name}` : `Removed ${name} from ${n} conversations`), () => {
      setLinks((m) => withLabel(m, changing, labelId, !on));
      write(changing, !on).then((ok) => { if (!ok) saveFailed(); });
    });
  }, [notify, saveFailed]);

  return useMemo(() => ({ labels, labelsOf, threadsWith, allWear, createLabel, updateLabel, deleteLabel, setLabel }),
    [labels, labelsOf, threadsWith, allWear, createLabel, updateLabel, deleteLabel, setLabel]);
}
