// The Attachments dialog opened from a conversation's More menu: every file in the conversation, each linking back to its message.

import { Paperclip } from "lucide-react";
import type { FiledAttachment } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/primitives";
import { AttachmentGrid } from "@/components/attachments";

interface AttachmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FiledAttachment[];
  /** Where Show in Conversation goes for a file: its message in this thread. */
  hrefFor: (a: FiledAttachment) => string;
}

export function AttachmentsDialog({ open, onOpenChange, files, hrefFor }: AttachmentsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attachments</DialogTitle>
          <DialogDescription>{files.length === 1 ? "1 file" : `${files.length} files`} in this conversation</DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0">
          {files.length === 0 ? (
            <EmptyState icon={Paperclip} title="No Attachments" description="Files sent in this conversation appear here." />
          ) : (
            <AttachmentGrid items={files} hrefFor={hrefFor} />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
