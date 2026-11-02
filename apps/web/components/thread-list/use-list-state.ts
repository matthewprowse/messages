"use client";

// The Inbox list's view, filter and carried query from the address, with analytics for the choices people make.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics";
import { filtersForView } from "@/lib/selection";
import { filterOf, viewOf } from "@/lib/thread-list";
import type { ListFilter, View } from "@/lib/types";

export function useListState() {
  const params = useSearchParams();
  const view: View = viewOf(params.get("view"));
  const rawFilter = filterOf(params.get("filter"));
  const filter: ListFilter = filtersForView(view).includes(rawFilter) ? rawFilter : "none";
  // Which view and filter people choose (the default is not a choice).
  useEffect(() => {
    if (view !== "all") track("feature_used", { feature: "conversation_view", detail: view });
  }, [view]);
  useEffect(() => {
    if (filter !== "none") track("feature_used", { feature: "conversation_filter", detail: filter });
  }, [filter]);
  // The label filtering the list, by id; one that no longer exists is simply matched by nothing, so it is ignored by the list.
  const label = params.get("label") ?? undefined;
  // A message jumped to from search belongs to one conversation, so it is not carried into list links.
  const query = new URLSearchParams(params);
  query.delete("message");
  // By Person (group=person) shows one row per contact; it is carried in the address like the view, so it survives a reload.
  const byPerson = params.get("group") === "person" && view !== "subscriptions" && view !== "deleted";
  return { view, filter, label, byPerson, query: query.toString() };
}
