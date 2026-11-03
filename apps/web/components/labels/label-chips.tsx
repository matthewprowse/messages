"use client";

// Under the Inbox view buttons: one chip per label to filter the list by it (click again to clear), and the list's "..."
// menu (Saved Views and By Person). A label filter lives in the address (?label=), like the view and the filter, so it
// survives reloads and links.

import Link from "next/link";
import { useState } from "react";
import { MoreHorizontal, Tags } from "lucide-react";
import { useApp } from "@/lib/store";
import { isShowing, labelDot, NAME_MAX, savedViewHref, suggestedViewName } from "@/lib/labels";
import { filterLabel, listHref, VIEWS } from "@/lib/thread-list";
import type { ListFilter, View } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
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

/**
 * The list's "..." menu: By Person (when `byPerson` is given: one row per contact), the saved views, and Save Current View.
 * One icon button, so the view buttons keep the row on a phone.
 */
export function ListMenu({ view, filter, label, byPerson }: Showing & { byPerson?: { on: boolean; toggle: () => void } }) {
  const { labels: api } = useApp();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const labelName = api.labels.find((l) => l.id === label)?.name;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await api.saveView(name, view, filter, label)) setNaming(false);
  };
  const duplicate = api.savedViews.some((v) => isShowing(v, view, filter, label));
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant={byPerson?.on ? "secondary" : "ghost"} size="icon" className="shrink-0" aria-label="List Options"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {byPerson && (
            <>
              <DropdownMenuCheckboxItem checked={byPerson.on} onCheckedChange={byPerson.toggle}>By Person</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel>Saved Views</DropdownMenuLabel>
          {api.savedViews.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Save a view and its filter and label to open it in one click.</div>}
          {api.savedViews.map((v) => (
            <DropdownMenuItem key={v.id} asChild>
              <Link href={savedViewHref(v)} replace aria-current={isShowing(v, view, filter, label) ? "page" : undefined}>{v.name}</Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={duplicate || view === "deleted"}
            onSelect={() => {
              setName(suggestedViewName(VIEWS.find((v) => v.key === view)?.label ?? "", filterLabel(filter), labelName));
              setNaming(true);
            }}
          >
            Save Current View
          </DropdownMenuItem>
          {api.savedViews.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Remove a Saved View</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {api.savedViews.map((v) => <DropdownMenuItem key={v.id} onSelect={() => api.deleteView(v.id)}>{v.name}</DropdownMenuItem>)}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={save} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Save Current View</DialogTitle>
              <DialogDescription>Opens the Inbox with this view, filter and label.</DialogDescription>
            </DialogHeader>
            <Input value={name} maxLength={NAME_MAX} aria-label="View Name" autoFocus onChange={(e) => setName(e.target.value)} />
            <div className={DIALOG_BUTTONS}>
              <Button type="submit" disabled={!name.trim()}>Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
