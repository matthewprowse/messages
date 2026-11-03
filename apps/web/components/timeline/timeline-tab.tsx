"use client";

// A client's timeline on their contact page: every channel, meeting, note, promise, task, document and lead in one list, newest
// first and grouped by day (a card each), with a search, a type filter and a matter picker. Messages come a page at a time; viewing it never
// marks a conversation read, so no WhatsApp read receipt goes out. Render it with key={contact.id}.

import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, Separated } from "@/components/surface";
import type { ContactDetail } from "@/lib/contacts";
import { countByType, filterTimeline, groupByDay } from "@/lib/timeline/build";
import { linkRefOf, matterRefs, type Matter, type MatterKind } from "@/lib/timeline/matters";
import type { TimelineItem, TimelineType } from "@/lib/timeline/types";
import { ALL_ACTIVITY, MatterBar } from "./matter-bar";
import { MatterDialog } from "./matter-dialog";
import { TimelineFilters } from "./timeline-filters";
import { TimelineRow } from "./timeline-row";
import { useMatters } from "./use-matters";
import { useTimeline } from "./use-timeline";

export function TimelineTab({ contact }: { contact: ContactDetail }) {
  const timeline = useTimeline(contact);
  const store = useMatters(contact.id);
  const [term, setTerm] = useState("");
  const [types, setTypes] = useState<TimelineType[]>([]);
  const [matterId, setMatterId] = useState(ALL_ACTIVITY);
  // The dialog: new (optionally putting an item in it at once) or rename.
  const [dialog, setDialog] = useState<{ matter?: Matter; thenAdd?: TimelineItem } | null>(null);

  const chosen = store.matters.find((m) => m.id === matterId);
  const refs = useMemo(() => (chosen ? matterRefs(store.links, chosen.id) : null), [chosen, store.links]);
  const shown = useMemo(
    () => filterTimeline(timeline.items, { types: new Set(types), term, matterRefs: refs }),
    [timeline.items, types, term, refs],
  );
  const days = useMemo(() => groupByDay(shown, new Date()), [shown]);
  const counts = useMemo(() => countByType(timeline.items), [timeline.items]);

  const save = async (name: string, kind: MatterKind) => {
    if (dialog?.matter) { store.edit(dialog.matter.id, name, kind); return; }
    const made = await store.create(name, kind);
    const ref = dialog?.thenAdd ? linkRefOf(dialog.thenAdd.refs) : null;
    if (made && ref) await store.add(made.id, ref.kind, ref.id);
    if (made) setMatterId(made.id);
  };

  const filtering = term.trim() !== "" || types.length > 0 || !!chosen;

  if (!timeline.ready && timeline.items.length === 0) {
    return <div className="grid gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>;
  }
  if (timeline.all.length === 0) {
    return <EmptyState icon={History} title="Nothing Yet" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <MatterBar
        matters={store.matters}
        value={chosen ? chosen.id : ALL_ACTIVITY}
        onChange={setMatterId}
        actions={{
          create: () => setDialog({}),
          rename: (matter) => setDialog({ matter }),
          close: (m, closed) => store.close(m.id, closed),
          remove: (m) => { store.remove(m.id); setMatterId(ALL_ACTIVITY); },
        }}
      />
      <TimelineFilters term={term} onTerm={setTerm} types={types} onTypes={setTypes} counts={counts} />

      {days.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {chosen && !term && types.length === 0 ? "Nothing in this matter yet." : "Nothing matches."}
          {!timeline.messagesDone && " Older history is not loaded yet."}
        </p>
      ) : (
        days.map((g) => (
          <Card key={g.day} title={g.label}>
            <Separated inset="none">
              {g.items.map((item) => (
                <TimelineRow
                  key={item.key}
                  item={item}
                  matters={{
                    matters: store.matters,
                    links: store.links,
                    onToggle: (m, it, held) => { const ref = linkRefOf(it.refs); if (ref) void (held ? store.take(m.id, ref.kind, ref.id) : store.add(m.id, ref.kind, ref.id)); },
                    onNew: (it) => setDialog({ thenAdd: it }),
                  }}
                />
              ))}
            </Separated>
          </Card>
        ))
      )}

      {!timeline.messagesDone && (
        <Button variant="secondary" className="self-center" disabled={timeline.paging} onClick={() => void timeline.more()}>
          {timeline.paging ? "Loading..." : filtering ? "Load Earlier History" : "Load Earlier"}
        </Button>
      )}
      {timeline.failed && <p className="text-center text-xs text-muted-foreground">Some of this timeline did not load. Reopen the page to try again.</p>}

      <MatterDialog open={!!dialog} onOpenChange={(open) => { if (!open) setDialog(null); }} matter={dialog?.matter} onSave={(n, k) => void save(n, k)} />
    </div>
  );
}
