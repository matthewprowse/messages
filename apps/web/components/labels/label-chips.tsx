"use client";

// Under the Conversations view buttons: one chip per label to filter the list by it (click again to clear). A label
// filter lives in the address (?label=), like the view and the filter, so it survives reloads and links.

import Link from "next/link";
import { Tags } from "lucide-react";
import { useApp } from "@/lib/store";
import { labelDot } from "@/lib/labels";
import { listHref } from "@/lib/thread-list";
import type { ListFilter, View } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { openManageLabels } from "./manage-labels-dialog";

interface Showing {
  view: View;
  filter: ListFilter;
  /** The label filtering the list, by id. */
  label?: string;
}

/** The label filter chips. Nothing at all until a label exists. */
export function LabelChips({ view, filter, label }: Showing) {
  const { labels: api } = useApp();
  if (api.labels.length === 0) return null;
  return (
    <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Labels">
      {api.labels.map((l) => {
        const active = l.id === label;
        return (
          <Button key={l.id} asChild size="sm" variant={active ? "secondary" : "ghost"} className={cn("shrink-0 px-2", !active && "text-muted-foreground")}>
            <Link href={listHref(view, filter, active ? undefined : l.id)} replace aria-pressed={active}>
              <span className={cn("size-2 rounded-full", labelDot(l.color))} aria-hidden />
              {l.name}
            </Link>
          </Button>
        );
      })}
      <Button size="icon-sm" variant="ghost" aria-label="Manage Labels" className="shrink-0" onClick={openManageLabels}><Tags /></Button>
    </div>
  );
}
