"use client";

// The view buttons and filter select at the top of the Inbox list.

import { useRouter } from "next/navigation";
import { filtersForView } from "@/lib/selection";
import { FILTER_OPTIONS, listHref, VIEWS } from "@/lib/thread-list";
import type { ListFilter, View } from "@/lib/types";
import { PaneControls, PaneSelect, ViewButtons } from "@/components/pane";

export function ListControls({ view, filter }: { view: View; filter: ListFilter }) {
  const router = useRouter();
  return (
    <PaneControls>
      <ViewButtons label="View" value={view} items={VIEWS} hrefFor={(v) => listHref(v, filter)} />
      <PaneSelect
        label="Filter"
        value={filter === "none" ? "" : filter}
        onChange={(f) => router.replace(listHref(view, f as ListFilter))}
        options={FILTER_OPTIONS.filter((o) => filtersForView(view).includes(o.key)).map((o) => ({ value: o.key, label: o.label }))}
      />
    </PaneControls>
  );
}
