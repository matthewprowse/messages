"use client";

// The Label button of the bulk bar: a menu of every label, ticked when all the checked conversations wear it.

import { Tag } from "lucide-react";
import { useApp } from "@/lib/store";
import { labelDot } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openManageLabels } from "./manage-labels-dialog";

export function LabelMenuButton({ ids }: { ids: string[] }) {
  const { labels: api } = useApp();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Label"><Tag /></Button></DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Label</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
        {api.labels.map((l) => (
          <DropdownMenuCheckboxItem key={l.id} checked={api.allWear(ids, l.id)} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => api.setLabel(ids, l.id, on)}>
            <span className={cn("size-2 shrink-0 rounded-full", labelDot(l.color))} aria-hidden />
            <span className="min-w-0 truncate">{l.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {api.labels.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => openManageLabels()}>{api.labels.length ? "Manage Labels" : "New Label"}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
