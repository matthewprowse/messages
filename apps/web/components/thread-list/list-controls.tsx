"use client";

// The view buttons and filter select at the top of the Inbox list.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";
import { filtersForView } from "@/lib/selection";
import { FILTER_OPTIONS, listHref, VIEWS } from "@/lib/thread-list";
import type { ListFilter, View } from "@/lib/types";
import { PaneControls, PaneSelect, ViewButtons } from "@/components/pane";

export function ListControls({ view, filter }: { view: View; filter: ListFilter }) {
  const router = useRouter();
  const { listThreads } = useApp();
  // Unread in Priority, and a dot on Junk when any of it is unread: the AI's work shows before you open a view.
  const items = useMemo(() => VIEWS.map((v) => (
    v.key === "priority" ? { ...v, count: listThreads("priority", "unread").length }
      : v.key === "junk" ? { ...v, dot: listThreads("junk", "unread").length > 0 }
        : v
  )), [listThreads]);
  return (
    <PaneControls>
      <ViewButtons label="View" value={view} items={items} hrefFor={(v) => listHref(v, filter)} />
      <PaneSelect
        label="Filter"
        value={filter === "none" ? "" : filter}
        onChange={(f) => router.replace(listHref(view, f as ListFilter))}
        options={FILTER_OPTIONS.filter((o) => filtersForView(view).includes(o.key)).map((o) => ({ value: o.key, label: o.label }))}
      />
    </PaneControls>
  );
}
