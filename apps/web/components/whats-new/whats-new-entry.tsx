// One released update as a reader sees it: version, date, title, a line about it and its changes under New, Improved and
// Fixed. Shared by the What's New dialog and the /whats-new page so both read the same.

import { dayLabel } from "@/lib/updates";
import { groupChanges, type ReaderUpdate } from "@/lib/updates-seen";
import { Badge } from "@/components/ui/badge";

/** The entry's heading and grouped changes. `compact` drops the heading when the dialog title already shows it. */
export function WhatsNewEntry({ update, compact = false }: { update: ReaderUpdate; compact?: boolean }) {
  return (
    <article aria-label={update.title} className="flex flex-col gap-3">
      {!compact && (
        <header className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {update.version && <Badge variant="secondary">{update.version}</Badge>}
            <span>{dayLabel(update.releasedOn)}</span>
          </span>
          <h2 className="text-sm font-medium">{update.title}</h2>
        </header>
      )}
      {update.summary && <p className="text-sm text-muted-foreground">{update.summary}</p>}
      {groupChanges(update.changes).map((g) => (
        <section key={g.kind}>
          <h3 className="text-sm font-medium">{g.label}</h3>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm marker:text-muted-foreground">
            {g.items.map((text, i) => <li key={i}>{text}</li>)}
          </ul>
        </section>
      ))}
    </article>
  );
}
