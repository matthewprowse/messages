"use client";

// A card that shows only its first few rows on the page, with See All opening the whole list (and each row's detail) in a
// dialog. Admin's per person spend lists use it, so a busy month does not turn the page into a wall of people.

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";
import { Card, Separated } from "@/components/surface";

/** How many rows show on the page before See All. */
export const TOP = 5;

/**
 * `row(item, full)` draws one item: `full` is false on the page (one line, no detail) and true in the dialog, where the
 * week, today and feature split can sit under it.
 */
export function TopRows<T>({ title, items, keyOf, row }: { title: string; items: T[]; keyOf: (item: T) => string; row: (item: T, full: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const more = items.length > TOP;
  return (
    <Card title={title} action={more ? <Button variant="ghost" onClick={() => setOpen(true)}>See All {items.length}</Button> : undefined}>
      <Separated>{items.slice(0, TOP).map((item) => <div key={keyOf(item)}>{row(item, false)}</div>)}</Separated>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <Separated>{items.map((item) => <div key={keyOf(item)}>{row(item, true)}</div>)}</Separated>
          </ScrollArea>
          <div className={DIALOG_BUTTONS}>
            <Button variant="secondary" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
