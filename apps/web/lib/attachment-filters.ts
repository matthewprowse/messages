// The Attachments page's filtering as plain functions: the tabs, what the address remembers, the Source list derived from
// the data, the date and search matching, who sent the files in view, and the honest header labels. No React, so it is
// tested here (attachment-filters.test.ts); the page only wires state to it.

import { filesLabel, SOURCE_LABEL, sourceOf, type Source } from "./attachment-view";
import type { Sort } from "./attachment-actions/selection";
import { formatSize } from "./format";
import type { Attachment, FiledAttachment, Provider } from "./types";

export type Kind = "all" | "image" | "pdf" | "video" | "audio" | "file";

export const KINDS: { key: Kind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "pdf", label: "PDFs" },
  { key: "video", label: "Videos" },
  { key: "audio", label: "Audio" },
  { key: "file", label: "Files" },
];

const DAY = 24 * 60 * 60 * 1000;
export const DATES: { key: string; label: string; days: number }[] = [
  { key: "any", label: "Any Time", days: 0 },
  { key: "week", label: "Past Week", days: 7 },
  { key: "month", label: "Past Month", days: 30 },
  { key: "quarter", label: "Past 3 Months", days: 90 },
  { key: "year", label: "Past Year", days: 365 },
];

/** Everything the page's controls set. All of it lives in the address, so a reload or a shared link comes back the same. */
export type Filters = { kind: Kind; source: string; date: string; person: string; q: string; sort: Sort };
export const NO_FILTERS: Filters = { kind: "all", source: "all", date: "any", person: "all", q: "", sort: "newest" };

/** The filters an address carries; an unknown tab or date falls back to the default rather than showing nothing. */
export function parseFilters(get: (key: string) => string | null): Filters {
  const kind = get("kind");
  const date = get("date");
  return {
    kind: KINDS.some((k) => k.key === kind) ? (kind as Kind) : "all",
    source: get("source") || "all",
    date: DATES.some((d) => d.key === date) ? (date as string) : "any",
    person: get("person") || "all",
    q: get("q") ?? "",
    sort: get("sort") === "largest" ? "largest" : "newest",
  };
}

/** The address for a set of filters: only what differs from the default is written. */
export function filtersHref(f: Filters): string {
  const next = new URLSearchParams();
  if (f.kind !== "all") next.set("kind", f.kind);
  if (f.source !== "all") next.set("source", f.source);
  if (f.date !== "any") next.set("date", f.date);
  if (f.person !== "all") next.set("person", f.person);
  if (f.q.trim()) next.set("q", f.q);
  if (f.sort !== "newest") next.set("sort", f.sort);
  const text = next.toString();
  return text ? `/attachments?${text}` : "/attachments";
}

/** True when a filter other than the tab narrows the list, or Largest reorders it: the page must hold every file to be honest. */
export const isNarrowed = (f: Filters) => f.source !== "all" || f.date !== "any" || f.person !== "all" || f.q.trim() !== "" || f.sort !== "newest";

/** A WhatsApp voice note belongs to its chat, so the Audio tab leaves it out. */
export const isVoiceNote = (a: Pick<Attachment, "kind" | "name">) => a.kind === "audio" && /^voice note\b/i.test(a.name);

/** The sources to offer: every provider that carries files and has either a conversation or a file here, by label. */
export function sourcesIn(providers: Iterable<Provider | undefined>): { key: Source; label: string }[] {
  const found = new Set<Source>();
  for (const p of providers) {
    const s = sourceOf(p);
    if (s) found.add(s);
  }
  return [...found].map((key) => ({ key, label: SOURCE_LABEL[key] ?? key })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The lower case text a search looks in: the file name, who sent it, their addresses and the conversation's subject. */
export const searchTextOf = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ").toLowerCase();

export type FilterContext = {
  /** The provider of a file's conversation. */
  sourceOf: (a: FiledAttachment) => Source | undefined;
  /** The text a search matches for a file (see searchTextOf). */
  text: (a: FiledAttachment) => string;
  now: number;
};

/** Everything but the person filter, so the list of people can say how many files each one has in view. */
export function filterFiles(files: FiledAttachment[], f: Filters, ctx: FilterContext): FiledAttachment[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const days = DATES.find((d) => d.key === f.date)?.days ?? 0;
  const since = days ? ctx.now - days * DAY : 0;
  return files.filter((a) => {
    if (f.kind === "audio" && isVoiceNote(a)) return false;
    if (f.source !== "all" && ctx.sourceOf(a) !== f.source) return false;
    if (since && Date.parse(a.sentAt) < since) return false;
    if (!words.length) return true;
    const haystack = ctx.text(a);
    return words.every((w) => haystack.includes(w));
  });
}

/** Everyone who sent one of the files, with you first and the rest by name. */
export function peopleIn(files: FiledAttachment[], nameOf: (id: string) => string): { id: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of files) counts.set(a.from, (counts.get(a.from) ?? 0) + 1);
  return [...counts]
    .sort(([x], [y]) => (x === "me" ? -1 : y === "me" ? 1 : nameOf(x).localeCompare(nameOf(y))))
    .map(([id, count]) => ({ id, name: nameOf(id), count }));
}

/** The chosen person if they still have files in view, otherwise Everyone, so the filter never hides itself. */
export const effectivePerson = (person: string, people: { id: string }[]) => (person !== "all" && people.some((p) => p.id === person) ? person : "all");

export type CountInput = {
  shown: number;
  /** Files the server says exist for this tab, when it can say (the Audio tab cannot: voice notes are dropped here). */
  total: number | null;
  /** More pages remain on the server. */
  more: boolean;
  /** A filter or search is on, so only the files loaded so far were looked at. */
  narrowed: boolean;
};

/** The header count. It is exact when nothing is narrowed or every page is loaded, and says so when it is still counting. */
export function countLabel({ shown, total, more, narrowed }: CountInput): string {
  if (!more) return filesLabel(shown);
  if (!narrowed && total !== null) return filesLabel(total);
  return `${filesLabel(shown)}, Still Searching`;
}

/** The size total of what is shown, marked as a floor while pages are still arriving. */
export function sizeLabel(files: Pick<Attachment, "path" | "bytes">[], more: boolean): string {
  const bytes = files.reduce((sum, f) => sum + (f.path ? f.bytes ?? 0 : 0), 0);
  return `${more ? "At Least " : ""}${formatSize(bytes)}`;
}
