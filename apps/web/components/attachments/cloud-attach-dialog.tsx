"use client";

// Where a note's files come from: This Device, Google Drive or OneDrive, with the note that iCloud Drive is already part
// of This Device on Apple devices. A note's toolbar has no room for a menu, so the choice is a dialog; the files then go
// to the note's own addFiles, like a dropped file.

import { ICLOUD_NOTE, SOURCE_LABEL } from "@/lib/cloud-pick/config";
import { useCloudPick, type PickRule } from "@/lib/cloud-pick/use-cloud-pick";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function CloudAttachDialog({ open, onOpenChange, rule, onFiles, notify, onDevice }: { open: boolean; onOpenChange: (open: boolean) => void; rule: PickRule; onFiles: (files: File[]) => void; notify: (message: string | null) => void; /** Opens the device's file chooser. */ onDevice: () => void }) {
  const { sources, busy, pick } = useCloudPick({ rule, onFiles, notify });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent track="attach_files" showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Attach Files</DialogTitle>
          <DialogDescription>{ICLOUD_NOTE}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button variant="secondary" onClick={() => { onOpenChange(false); onDevice(); }}>This Device</Button>
          {/* The picker opens from this click, so the dialog closes after it starts rather than before. */}
          {sources.map((s) => (
            <Button key={s} variant="secondary" disabled={!!busy} onClick={() => { void pick(s); onOpenChange(false); }}>{SOURCE_LABEL[s]}</Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
