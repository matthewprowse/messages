// The dialog that asks what to change before the AI edits your text (Edit Text). Drafting no longer has one: its
// "What Should This Say?" field is in the draft bar. Presentational: the composer owns the state and runs the request.

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface AskDialogsProps {
  asking: "edit" | null;
  onClose: () => void;
  busy: boolean;
  change: string;
  onChange: (value: string) => void;
  onStartEdit: () => void;
}

export function AskDialogs({ asking, onClose, busy, change, onChange, onStartEdit }: AskDialogsProps) {
  return (
    <Dialog open={asking === "edit"} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} track="edit_text" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Text</DialogTitle>
          <DialogDescription>Say what to change in your text, or leave it empty to fix spelling and wording only. Your meaning stays the same and nothing is sent.</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={3}
          value={change}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onStartEdit(); } }}
          placeholder="For example: make it friendlier and mention the invoice"
          aria-label="What To Change"
          className="resize-none"
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onStartEdit}>Edit Text</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
