// Which events the Calendar page shows once the search and the deleted-but-not-yet-gone events are applied. Pure, so it is unit tested.

interface Filterable {
  id: string;
  title: string;
  location?: string | null;
  description?: string | null;
  seriesId?: string | null;
}

export interface HiddenEvent {
  id: string;
  scope?: "occurrence" | "series";
  seriesId?: string | null;
}

/** The events matching the search (already trimmed and lowercased; empty matches all) and not hidden. */
export function visibleEvents<T extends Filterable>(all: T[], term: string, hidden: HiddenEvent[]): T[] {
  const found = term ? all.filter((e) => [e.title, e.location, e.description].some((s) => s?.toLowerCase().includes(term))) : all;
  return hidden.length ? found.filter((e) => !hidden.some((h) => h.id === e.id || (h.scope === "series" && h.seriesId && h.seriesId === e.seriesId))) : found;
}
