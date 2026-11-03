"use client";

// The view buttons, filter select and "..." menu (Saved Views, By Person) at the top of the Inbox list, with the label
// chips under them. The filter offers the channels you have conversations on.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { withGroup } from "@/lib/person-groups-href";
import { channelsOf, filterFits, filterOptions, listHref, VIEWS } from "@/lib/thread-list";
import type { ListFilter, View } from "@/lib/types";
import { PaneControls, PaneSelect, ViewButtons } from "@/components/pane";
import { LabelChips, ListMenu } from "@/components/labels/label-chips";

export function ListControls({ view, filter, label, byPerson = false }: { view: View; filter: ListFilter; label?: string; byPerson?: boolean }) {
  const router = useRouter();
  // The By Person choice rides along in every link this row makes, so changing the view or filter keeps it.
  const href = (v: View, f: ListFilter) => withGroup(listHref(v, f, shownLabel), byPerson);
  const { threads, listThreads, labels: api } = useApp();
  // Unread in Priority, and a dot on Junk when any of it is unread: the AI's work shows before you open a view.
  const items = useMemo(() => VIEWS.map((v) => (
    v.key === "priority" ? { ...v, count: listThreads("priority", "unread").length }
      : v.key === "junk" ? { ...v, dot: listThreads("junk", "unread").length > 0 }
        : v
  )), [listThreads]);
  const channels = useMemo(() => channelsOf(threads), [threads]);
  const options = filterOptions(channels).filter((o) => filterFits(view, o.key));
  // A label that was deleted (an old link) is dropped from the address's meaning here too.
  const shownLabel = label && api.labels.some((l) => l.id === label) ? label : undefined;
  return (
    <>
      <PaneControls>
        <ViewButtons label="View" value={view} items={items} hrefFor={(v) => href(v, filter)} />
        <div className="flex shrink-0 items-center gap-1">
          {options.length > 1 && (
            <PaneSelect
              label="Filter"
              value={filter === "none" ? "" : filter}
              onChange={(f) => router.replace(href(view, f as ListFilter))}
              options={options.map((o) => ({ value: o.key, label: o.label }))}
            />
          )}
          {/* By Person is one row per person, with their email and chats together (not for Subscriptions or Deleted, which are not about people). */}
          <ListMenu
            view={view}
            filter={filter}
            label={shownLabel}
            byPerson={view !== "subscriptions" && view !== "deleted" ? { on: byPerson, toggle: () => router.replace(withGroup(listHref(view, filter, shownLabel), !byPerson)) } : undefined}
          />
        </div>
      </PaneControls>
      <LabelChips view={view} filter={filter} label={shownLabel} />
    </>
  );
}
