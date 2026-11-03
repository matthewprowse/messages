// One released update as a reader sees it: its title, a line about it and its changes under New, Improved and Fixed. Shared
// by the What's New dialog and Settings, What's New (whose card title row carries the version and date) so both read the same.

import { groupChanges, type ReaderUpdate } from "@/lib/updates-seen";

/** The entry's title and grouped changes. `compact` drops the title when the dialog's own title already shows it. */
export function WhatsNewEntry({ update, compact = false }: { update: ReaderUpdate; compact?: boolean }) {
  return (
    <article aria-label={update.title} className="flex flex-col gap-3">
      {!compact && <h3 className="text-sm font-medium">{update.title}</h3>}
      {update.summary && <p className="text-sm text-muted-foreground">{update.summary}</p>}
      {groupChanges(update.changes).map((g) => (
        <section key={g.kind}>
          <h4 className="text-sm font-medium">{g.label}</h4>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm marker:text-muted-foreground">
            {g.items.map((text, i) => <li key={i}>{text}</li>)}
          </ul>
        </section>
      ))}
    </article>
  );
}
