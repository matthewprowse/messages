// What's New with no network in it: mapping a published row, which entry is the newest, whether the dialog should open for
// this person, and the entry's changes grouped New, Improved, Fixed. lib/updates-reader.ts (Supabase) uses it, and so do the
// What's New components. The owner's side of the changelog is lib/updates-model.ts.

import type { Tables } from "@messages/db";
import { CHANGE_KINDS, mapUpdate, type Change, type ChangeKind, type Update } from "./updates-model";

/** A published release as a reader sees it. publishedAt is when it went public; older rows without one fall back to createdAt. */
export interface ReaderUpdate extends Pick<Update, "id" | "version" | "title" | "summary" | "changes" | "releasedOn" | "createdAt"> { publishedAt: string | null }

export const READER_COLUMNS = "id, version, title, summary, changes, released_on, published, created_at, updated_at, published_at";
export type ReaderRow = Pick<Tables<"updates">, "id" | "version" | "title" | "summary" | "changes" | "released_on" | "published" | "created_at" | "updated_at" | "published_at">;

export function mapReaderUpdate(row: ReaderRow): ReaderUpdate {
  const { id, version, title, summary, changes, releasedOn, createdAt } = mapUpdate(row);
  return { id, version, title, summary, changes, releasedOn, createdAt, publishedAt: row.published_at };
}

/** The moment an entry became visible. "Newer than what I saw" is measured on this, not on the release date, which the owner can back-date. */
export const updateKey = (u: Pick<ReaderUpdate, "publishedAt" | "createdAt">): string => u.publishedAt ?? u.createdAt;

const ms = (iso: string | undefined | null): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** Newest published first. Ties fall back to the release date, then the id, so the order never flickers. */
export function sortPublished(list: ReaderUpdate[]): ReaderUpdate[] {
  return [...list].sort((a, b) => ms(updateKey(b)) - ms(updateKey(a)) || b.releasedOn.localeCompare(a.releasedOn) || b.id.localeCompare(a.id));
}

/** The newest entry that has something to show, or undefined. An entry with no changes is a title only, so it is not worth a dialog. */
export const latestUpdate = (list: ReaderUpdate[]): ReaderUpdate | undefined => sortPublished(list).find((u) => u.changes.length > 0);

/** The marker saved in the sign-in metadata (whatsNewSeen), or undefined when it is missing or not a string. */
export const seenFromMetadata = (meta: Record<string, unknown> | undefined): string | undefined => (typeof meta?.whatsNewSeen === "string" ? meta.whatsNewSeen : undefined);

/** True when the dialog should open: the newest entry went public after the last one this person saw. Someone who has never
 * seen one is compared with the day they joined, so a new sign-up is not shown a release that came before them. Nothing opens
 * while setup is still running, because the setup dialog is the first thing a new person should see. */
export function shouldShowWhatsNew(o: { latest: ReaderUpdate | undefined; seen: string | undefined; joinedAt: string | undefined; onboarding: string | undefined }): boolean {
  if (!o.latest) return false;
  if (o.onboarding !== undefined && o.onboarding !== "done") return false;
  const since = [o.seen, o.joinedAt].find((s) => ms(s) !== Number.NEGATIVE_INFINITY);
  return since !== undefined && ms(updateKey(o.latest)) > ms(since);
}

/** The changes under New, Improved and Fixed in that order, leaving out a heading with nothing under it. */
export function groupChanges(changes: Change[]): { kind: ChangeKind; label: string; items: string[] }[] {
  return CHANGE_KINDS.map(({ key, label }) => ({ kind: key, label, items: changes.filter((c) => c.kind === key).map((c) => c.text) })).filter((g) => g.items.length > 0);
}
