// The Inbox list in By Person mode: the same conversations the list holds (after its view, filter and search), one row per person.
// The Inbox list shows this in place of its conversation rows when the address has group=person.

import { Fragment, useMemo } from "react";
import { useParams } from "next/navigation";
import { useApp } from "@/lib/store";
import type { Thread } from "@/lib/types";
import { groupByPerson } from "@/lib/person-groups";
import { Separator } from "@/components/ui/separator";
import { PersonRow } from "@/components/person/person-row";

export function PersonList({ threads, query, limit }: { threads: Thread[]; query: string; limit: number }) {
  const { contactById, prefetchMessages } = useApp();
  const params = useParams<{ id?: string }>();
  const groups = useMemo(() => groupByPerson(threads), [threads]);
  return (
    <div className="flex flex-col gap-2">
      {groups.slice(0, limit).map((g, i) => (
        <Fragment key={g.key}>
          {i > 0 && <div className="pl-14"><Separator /></div>}
          <PersonRow group={g} contact={g.personId ? contactById(g.personId) : undefined} query={query} selected={params.id === (g.personId ?? g.newest.id)} onPress={prefetchMessages} />
        </Fragment>
      ))}
    </div>
  );
}
