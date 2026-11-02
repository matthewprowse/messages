// User labels and saved views as plain data rules: the colour palette, tidying a typed name, which labels a thread
// wears, and the Inbox link a saved view opens. No React, no database. The store side is app-store/use-labels.ts.

import { listHref } from "./thread-list";
import type { ListFilter, View } from "./types";

/** The stock palette names a label may use; the database check constraint lists the same ones. */
export const LABEL_COLORS = ["gray", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

// Whole class names, so Tailwind sees them.
const DOT: Record<LabelColor, string> = {
  gray: "bg-gray-500", red: "bg-red-500", orange: "bg-orange-500", amber: "bg-amber-500", green: "bg-green-500",
  teal: "bg-teal-500", blue: "bg-blue-500", violet: "bg-violet-500", pink: "bg-pink-500",
};

/** The background class of a label's colour dot. */
export const labelDot = (color: string): string => DOT[color as LabelColor] ?? DOT.gray;

/** Longest label or saved view name. */
export const NAME_MAX = 40;

export interface Label {
  id: string;
  name: string;
  color: LabelColor;
}

/** A saved Inbox address: which view, which filter and which label. */
export interface SavedView {
  id: string;
  name: string;
  view: View;
  filter: ListFilter;
  labelId?: string;
}

/** A typed name tidied (spaces collapsed, cut to NAME_MAX), or null when nothing is left. */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return name || null;
}

/** Whether another label already has this name, ignoring case. `except` is the label being renamed. */
export function nameTaken(labels: Pick<Label, "id" | "name">[], name: string, except?: string): boolean {
  const wanted = name.toLowerCase();
  return labels.some((l) => l.id !== except && l.name.toLowerCase() === wanted);
}

/** The palette colour least used so far, so new labels start different from each other. */
export function nextColor(labels: Pick<Label, "color">[]): LabelColor {
  const used = new Map<string, number>();
  for (const l of labels) used.set(l.color, (used.get(l.color) ?? 0) + 1);
  const colours = LABEL_COLORS.filter((c) => c !== "gray");
  return colours.reduce((best, c) => ((used.get(c) ?? 0) < (used.get(best) ?? 0) ? c : best), colours[0]);
}

/** Label ids by thread id, from the stored links. */
export function linksByThread(rows: { thread_id: string; label_id: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.thread_id, [...(out.get(r.thread_id) ?? []), r.label_id]);
  return out;
}

/** The links with a label put on (or taken off) these threads. Pure, so Undo can hand the old map back. */
export function withLabel(links: Map<string, string[]>, threadIds: string[], labelId: string, on: boolean): Map<string, string[]> {
  const next = new Map(links);
  for (const id of threadIds) {
    const have = (next.get(id) ?? []).filter((l) => l !== labelId);
    const now = on ? [...have, labelId] : have;
    if (now.length) next.set(id, now); else next.delete(id);
  }
  return next;
}

/** Whether every one of these threads wears the label: what a checked menu item shows. */
export function allWear(links: Map<string, string[]>, threadIds: string[], labelId: string): boolean {
  return threadIds.length > 0 && threadIds.every((id) => links.get(id)?.includes(labelId));
}

/** Drops a deleted label from every thread's links. */
export function withoutLabel(links: Map<string, string[]>, labelId: string): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const [id, ids] of links) {
    const rest = ids.filter((l) => l !== labelId);
    if (rest.length) next.set(id, rest);
  }
  return next;
}

/** The Inbox link a saved view opens. */
export const savedViewHref = (v: SavedView) => listHref(v.view, v.filter, v.labelId);

/** Whether the Inbox is showing exactly this saved view. */
export const isShowing = (v: SavedView, view: View, filter: ListFilter, labelId: string | undefined) =>
  v.view === view && v.filter === filter && (v.labelId ?? undefined) === labelId;

/** A suggested name for saving the current Inbox view: "Priority, Unread, Client X". */
export function suggestedViewName(viewLabel: string, filterLabel: string | undefined, labelName: string | undefined): string {
  return [viewLabel, filterLabel, labelName].filter(Boolean).join(", ").slice(0, NAME_MAX);
}
