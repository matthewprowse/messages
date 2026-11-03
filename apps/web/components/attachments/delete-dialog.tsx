"use client";

// Asks before files are deleted from Konva's storage, saying in one line that only Konva's copy goes.

import type { FiledAttachment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DIALOG_BUTTONS } from "@/components/merge-dialog";

export function DeleteFilesDialog({ files, busy, onCancel, onConfirm }: { files: FiledAttachment[] | null; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  // Only files with a stored copy are deleted, so the count is theirs.
  const stored = files?.filter((f) => !!f.path).length ?? 0;
  return (
    <Dialog open={!!files} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent track="delete_attachments" showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{stored === 1 ? "Delete File" : stored > 1 ? `Delete ${stored.toLocaleString()} Files` : "Delete Files"}</DialogTitle>
          <DialogDescription>Only Konva&apos;s copy is deleted. The emails and chats keep theirs.</DialogDescription>
        </DialogHeader>
        <div className={DIALOG_BUTTONS}>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? "Deleting" : "Delete"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
