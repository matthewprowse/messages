"use client";

// The view buttons, saved views menu and filter select at the top of the Inbox list, with the label chips under them.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { filtersForView } from "@/lib/selection";
import { FILTER_OPTIONS, listHref, VIEWS } from "@/lib/thread-list";
import type { ListFilter, View } from "@/lib/types";
import { PaneControls, PaneSelect, ViewButtons } from "@/components/pane";
import { LabelChips, SavedViewsMenu } from "@/components/labels/label-chips";

export function ListControls({ view, filter, label }: { view: View; filter: ListFilter; label?: string }) {
  const router = useRouter();
  const { listThreads, labels: api } = useApp();
  // Unread in Priority, and a dot on Junk when any of it is unread: the AI's work shows before you open a view.
  const items = useMemo(() => VIEWS.map((v) => (
    v.key === "priority" ? { ...v, count: listThreads("priority", "unread").length }
      : v.key === "junk" ? { ...v, dot: listThreads("junk", "unread").length > 0 }
        : v
  )), [listThreads]);
  const options = FILTER_OPTIONS.filter((o) => filtersForView(view).includes(o.key));
  // A label that was deleted (an old link) is dropped from the address's meaning here too.
  const shownLabel = label && api.labels.some((l) => l.id === label) ? label : undefined;
  return (
    <>
      <PaneControls>
        <ViewButtons label="View" value={view} items={items} hrefFor={(v) => listHref(v, filter, shownLabel)} />
        <SavedViewsMenu view={view} filter={filter} label={shownLabel} />
        {options.length > 1 && (
          <PaneSelect
            label="Filter"
            value={filter === "none" ? "" : filter}
            onChange={(f) => router.replace(listHref(view, f as ListFilter, shownLabel))}
            options={options.map((o) => ({ value: o.key, label: o.label }))}
          />
        )}
      </PaneControls>
      <LabelChips view={view} filter={filter} label={shownLabel} />
    </>
  );
}
