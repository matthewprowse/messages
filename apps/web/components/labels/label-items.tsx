"use client";

// The Label entry of a conversation's menu: every label as a checked item (checked when all the chosen conversations wear
// it), and New Label. Mounted only while a menu is open, so it reads the labels when needed.

import { useApp } from "@/lib/store";
import { labelDot } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { MenuKit } from "@/components/snooze/menu-kit";
import { openManageLabels } from "./manage-labels-dialog";

export function LabelItems({ kit: { Item, CheckboxItem, Separator, Sub, SubTrigger, SubContent }, ids }: { kit: MenuKit; ids: string[] }) {
  const { labels: api } = useApp();
  return (
    <Sub>
      <SubTrigger>Label</SubTrigger>
      <SubContent className="max-h-72 overflow-y-auto">
        {api.labels.map((l) => (
          <CheckboxItem
            key={l.id}
            checked={api.allWear(ids, l.id)}
            // Stays open, so several labels can be ticked in one go.
            onSelect={(e: Event) => e.preventDefault()}
            onCheckedChange={(on: boolean) => api.setLabel(ids, l.id, on)}
          >
            <span className={cn("size-2 shrink-0 rounded-full", labelDot(l.color))} aria-hidden />
            <span className="min-w-0 truncate">{l.name}</span>
          </CheckboxItem>
        ))}
        {api.labels.length > 0 && <Separator />}
        <Item onSelect={() => openManageLabels()}>{api.labels.length ? "Manage Labels" : "New Label"}</Item>
      </SubContent>
    </Sub>
  );
}
