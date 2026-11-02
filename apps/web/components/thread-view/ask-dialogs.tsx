// The two dialogs that ask what you want before the AI writes: Draft (what the reply should cover) and Edit Text (what to
// change in your text). Presentational: the composer owns the state and runs the request.

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface AskDialogsProps {
  asking: "draft" | "edit" | null;
  onClose: () => void;
  busy: boolean;
  hasDraft: boolean;
  draftLabel: string;
  instruction: string;
  onInstruction: (value: string) => void;
  change: string;
  onChange: (value: string) => void;
  onStartDraft: () => void;
  onStartEdit: () => void;
  onRecordInstead: () => void;
}

export function AskDialogs({ asking, onClose, busy, hasDraft, draftLabel, instruction, onInstruction, change, onChange, onStartDraft, onStartEdit, onRecordInstead }: AskDialogsProps) {
  return (
    <>
      <Dialog open={asking === "draft"} onOpenChange={(open) => !open && onClose()}>
        <DialogContent showCloseButton={false} track="draft_reply" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draftLabel}</DialogTitle>
            <DialogDescription>
              {hasDraft
                ? "This writes a brand new draft and replaces the current one. Say what it should cover, or leave it empty to try again. Undo brings the old one back."
                : "Say what the reply should cover, or leave it empty and Konva writes it from the conversation. Nothing is sent until you press Send."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={instruction}
            onChange={(e) => onInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onStartDraft(); } }}
            placeholder="For example: say yes and suggest Thursday"
            aria-label="What To Say"
            className="resize-none"
          />
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="secondary" onClick={onRecordInstead}>Record Instead</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={onStartDraft}>{draftLabel}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    </>
  );
}
