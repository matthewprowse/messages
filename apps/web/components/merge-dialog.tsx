"use client";

import { useEffect, useState } from "react";
import { markSubmitted } from "@/lib/analytics";
import { namesDiffer } from "@/lib/merging";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Buttons at the foot of a dialog, without the shaded footer bar. */
export const DIALOG_BUTTONS = "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end";

/** An alert dialog ignores clicks outside it; ours close on them, like every other dialog. */
export function useCloseOnOverlay(open: boolean, onOpenChange: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-slot=alert-dialog-overlay]")) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onOpenChange]);
}

/**
 * Confirms a merge. When the two names differ meaningfully the buttons are the two names, so choosing
 * one is the confirmation; otherwise a single Merge button. The dialog stays open, showing Merging,
 * until onConfirm has finished.
 */
export function MergeDialog({
  a,
  b,
  open,
  onOpenChange,
  onConfirm,
}: {
  a: { name: string } | null;
  b: { name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name?: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  useCloseOnOverlay(open && busy === null, onOpenChange);
  if (!a || !b) return null;
  const ask = namesDiffer(a.name, b.name);

  const run = async (e: React.MouseEvent, key: string, name?: string) => {
    // Stays open until the merge is done.
    e.preventDefault();
    if (busy) return;
    markSubmitted("merge_contacts");
    setBusy(key);
    try {
      await onConfirm(name);
    } finally {
      setBusy(null);
      onOpenChange(false);
    }
  };
  const label = (key: string, text: string) => (
    <span className="min-w-0 max-w-full truncate">{busy === key ? "Merging" : text}</span>
  );

  return (
    <AlertDialog open={open} onOpenChange={(next) => busy === null && onOpenChange(next)}>
      <AlertDialogContent track="merge_contacts">
        <AlertDialogHeader>
          <AlertDialogTitle>{ask ? "Which Name Should We Keep?" : "Merge These Contacts?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {a.name} and {b.name} become one contact with all their addresses, numbers and conversations. You can undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className={DIALOG_BUTTONS}>
          <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
          {ask ? (
            <>
              <AlertDialogAction variant="outline" className="max-w-full min-w-0" disabled={busy !== null} onClick={(e) => run(e, "b", b.name.trim())}>{label("b", b.name)}</AlertDialogAction>
              <AlertDialogAction className="max-w-full min-w-0" disabled={busy !== null} onClick={(e) => run(e, "a", a.name.trim())}>{label("a", a.name)}</AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction disabled={busy !== null} onClick={(e) => run(e, "merge")}>{label("merge", "Merge")}</AlertDialogAction>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
