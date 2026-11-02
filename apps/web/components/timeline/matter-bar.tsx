"use client";

// The matter picker above a timeline: All Activity or one matter, with New Matter, and for the chosen one Rename, Close or
// Reopen, and Delete. Deleting only drops the grouping; the conversations, notes and files stay.

import { useState } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KIND_LABEL, sortMatters, type Matter } from "@/lib/timeline/matters";

export const ALL_ACTIVITY = "all";

export interface MatterActions { create: () => void; rename: (m: Matter) => void; close: (m: Matter, closed: boolean) => void; remove: (m: Matter) => void }

export function MatterBar({ matters, value, onChange, actions }: { matters: Matter[]; value: string; onChange: (id: string) => void; actions: MatterActions }) {
  const [confirm, setConfirm] = useState<Matter | null>(null);
  const chosen = matters.find((m) => m.id === value);
  const sorted = sortMatters(matters);
  return (
    <div className="flex items-center gap-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="min-w-0 justify-between gap-2">
            <span className="truncate">{chosen ? chosen.name : "All Activity"}</span>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-max min-w-56 overflow-y-auto">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            <DropdownMenuRadioItem value={ALL_ACTIVITY}>All Activity</DropdownMenuRadioItem>
            {sorted.length > 0 && <DropdownMenuSeparator />}
            {sorted.map((m) => (
              <DropdownMenuRadioItem key={m.id} value={m.id}>
                <span className="truncate">{m.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{KIND_LABEL[m.kind]}{m.closed ? ", Closed" : ""}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={actions.create}>New Matter</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {chosen && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Matter Options"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{KIND_LABEL[chosen.kind]}{chosen.closed ? ", Closed" : ", Open"}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => actions.rename(chosen)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.close(chosen, !chosen.closed)}>{chosen.closed ? "Reopen" : "Close Matter"}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(chosen)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete This Matter?</AlertDialogTitle>
            <AlertDialogDescription>Only the matter goes. Its conversations, notes and files stay where they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) actions.remove(confirm); setConfirm(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
