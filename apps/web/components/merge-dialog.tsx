"use client";

import { useEffect } from "react";
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
 * one is the confirmation; otherwise a single Merge button.
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
  onConfirm: (name?: string) => void;
}) {
  useCloseOnOverlay(open, onOpenChange);
  if (!a || !b) return null;
  const ask = namesDiffer(a.name, b.name);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{ask ? "Which Name Should We Keep?" : "Merge These Contacts?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {a.name} and {b.name} become one contact with all their addresses, numbers and conversations. You can undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className={DIALOG_BUTTONS}>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {ask ? (
            <>
              <AlertDialogAction variant="outline" onClick={() => onConfirm(b.name.trim())}>{b.name}</AlertDialogAction>
              <AlertDialogAction onClick={() => onConfirm(a.name.trim())}>{a.name}</AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction onClick={() => onConfirm()}>Merge</AlertDialogAction>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
