"use client";

// The controls at the top of the Conversations list: the view buttons, and the Filter button in the title row. The filter offers the channels you have conversations on, and By Person.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ListFilter as ListFilterIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import { withGroup } from "@/lib/person-groups-href";
import { channelsOf, filterFits, filterOptions, listHref, VIEWS } from "@/lib/thread-list";
import type { ListFilter, View } from "@/lib/types";
import { ViewButtons } from "@/components/pane";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Showing = { view: View; filter: ListFilter; label?: string; byPerson?: boolean };

/** The label still shown (a deleted one from an old link is dropped), and links that keep it and the By Person choice. */
function useListLinks(label: string | undefined, byPerson: boolean) {
  const { labels: api } = useApp();
  const shownLabel = label && api.labels.some((l) => l.id === label) ? label : undefined;
  const href = (v: View, f: ListFilter) => withGroup(listHref(v, f, shownLabel), byPerson);
  return { shownLabel, href };
}

export function ListControls({ view, filter, label, byPerson = false }: Showing) {
  const { listThreads } = useApp();
  const { href } = useListLinks(label, byPerson);
  // Unread in Priority: the AI's work shows before you open the view.
  const items = useMemo(() => VIEWS.map((v) => (v.key === "priority" ? { ...v, count: listThreads("priority", "unread").length } : v)), [listThreads]);
  return <ViewButtons label="View" value={view} items={items} hrefFor={(v) => href(v, filter)} />;
}

/**
 * The title row's Filter: an icon until a filter or By Person is on, then the filter's name (or "By Person"). By Person is one
 * row per person, with their email and chats together; not for Subscriptions or Deleted, which are not about people.
 */
export function FilterButton({ view, filter, label, byPerson = false }: Showing) {
  const router = useRouter();
  const { threads } = useApp();
  const { shownLabel, href } = useListLinks(label, byPerson);
  const channels = useMemo(() => channelsOf(threads), [threads]);
  const options = filterOptions(channels).filter((o) => filterFits(view, o.key));
  const canGroup = view !== "subscriptions" && view !== "deleted";
  if (options.length < 2 && !canGroup) return null;
  const active = options.find((o) => o.key === filter && o.key !== "none");
  const grouped = canGroup && byPerson;
  const name = active && grouped ? "2 Filters" : active?.label ?? (grouped ? "By Person" : undefined);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={name ? "secondary" : "ghost"} size={name ? "default" : "icon"} aria-label={name ? `Filter, ${name}` : "Filter"}>
          <ListFilterIcon />
          {name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {options.length > 1 && (
          <DropdownMenuRadioGroup value={active?.key ?? "none"} onValueChange={(f) => router.replace(href(view, f as ListFilter))}>
            {options.map((o) => <DropdownMenuRadioItem key={o.key} value={o.key}>{o.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        )}
        {options.length > 1 && canGroup && <DropdownMenuSeparator />}
        {canGroup && (
          <DropdownMenuCheckboxItem checked={byPerson} onCheckedChange={() => router.replace(withGroup(listHref(view, filter, shownLabel), !byPerson))}>By Person</DropdownMenuCheckboxItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
