"use client";

// The Summary's Filter in its title row, the same as the Conversations one: an icon until a filter is on, then the
// filter's name. The choice lives in the address and replaces it, keeping the open conversation.

import { useRouter } from "next/navigation";
import { ListFilter as ListFilterIcon } from "lucide-react";
import { listHref } from "@/lib/summary-list";
import type { ListFilter } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/tip";

export function SummaryFilter({ filter, options, openId }: { filter: ListFilter; options: { key: ListFilter; label: string }[]; openId?: string }) {
  const router = useRouter();
  const active = options.find((o) => o.key === filter && o.key !== "none");
  return (
    <DropdownMenu>
      <Tip label="Filter">
        <DropdownMenuTrigger asChild>
          <Button variant={active ? "secondary" : "ghost"} size={active ? "default" : "icon"} aria-label={active ? `Filter, ${active.label}` : "Filter"}>
            <ListFilterIcon />
            {active?.label}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup value={active?.key ?? "none"} onValueChange={(f) => router.replace(listHref(f as ListFilter, openId))}>
          {options.map((o) => <DropdownMenuRadioItem key={o.key} value={o.key}>{o.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
