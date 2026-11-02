"use client";

// Asks before files are deleted from Konva's storage. Says plainly that the email or chat they came with stays, and that
// a file stored once for several conversations goes only when its last copy does.

import { deleteWords } from "@/lib/attachment-actions/selection";
import type { FiledAttachment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function DeleteFilesDialog({ files, busy, onCancel, onConfirm }: { files: FiledAttachment[] | null; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const words = files ? deleteWords(files) : null;
  return (
    <Dialog open={!!files} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent track="delete_attachments" showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{words?.title ?? "Delete Files"}</DialogTitle>
          <DialogDescription>{words?.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? "Deleting" : "Delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
