"use client";

import { createContext, useContext, useState } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { FileX } from "lucide-react";
import { useSignedUrl } from "@/lib/signed-urls";
import { BUCKET } from "@/lib/outbox-files";
import { noteAttachment, type NoteFile } from "@/lib/notes";
import { NoteFileBase } from "@/lib/note-markdown";
import { cn } from "@/lib/utils";
import { AttachmentTile } from "@/components/attachments";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

export interface NoteFilesValue {
  files: Map<string, NoteFile>;
  loaded: boolean;
  /** Upload progress, 0 to 1, by upload key. */
  uploads: Map<string, number>;
  open: (file: NoteFile) => void;
  /** Whether a stopped upload still has its file, so it can be tried again. */
  canRetry: (upload: string) => boolean;
  retry: (upload: string) => void;
}

export const NoteFilesContext = createContext<NoteFilesValue>({ files: new Map(), loaded: false, uploads: new Map(), open: () => {}, canRetry: () => false, retry: () => {} });

// The file block, drawn as the image itself or a file tile; see lib/note-markdown.ts for how it is stored.
export const NoteFileNode = NoteFileBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(NoteFileView);
  },
});

function NoteFileView({ node, selected, deleteNode }: ReactNodeViewProps) {
  const { files, loaded, uploads, open, canRetry, retry } = useContext(NoteFilesContext);
  const { id, name, image, upload } = node.attrs as { id: string | null; name: string; image: boolean; upload: string | null };
  const file = id ? files.get(id) : undefined;

  let body: React.ReactNode;
  if (!id) {
    const progress = upload ? uploads.get(upload) : undefined;
    body = (
      <div className="flex w-full max-w-sm flex-col gap-2 rounded-lg border p-3">
        <span className="truncate text-sm">{name}</span>
        {progress === undefined ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Upload Stopped</span>
            {upload && canRetry(upload) && <Button variant="link" size="sm" onClick={() => retry(upload)}>Try Again</Button>}
            <Button variant="link" size="sm" onClick={() => deleteNode()}>Remove</Button>
          </div>
        ) : (
          <Progress value={progress * 100} aria-label={`Uploading ${name}`} />
        )}
      </div>
    );
  } else if (!file) {
    body = loaded ? (
      <div className="flex size-32 flex-col items-center justify-center gap-1 rounded-lg bg-muted p-2 text-center text-xs text-muted-foreground">
        <FileX className="size-6" strokeWidth={1.5} />
        <span className="line-clamp-2">File Not Found</span>
      </div>
    ) : (
      <Skeleton className={image ? "aspect-video w-full max-w-md rounded-lg" : "size-32 rounded-lg"} />
    );
  } else if (image) {
    body = <NoteImage file={file} onOpen={() => open(file)} />;
  } else {
    body = <AttachmentTile attachment={noteAttachment(file)} onOpen={() => open(file)} className="size-32" />;
  }

  return (
    <NodeViewWrapper data-drag-handle contentEditable={false} className={cn("my-3 w-fit max-w-full rounded-lg", selected && "ring-2 ring-ring/50 ring-offset-2 ring-offset-background")}>
      {body}
    </NodeViewWrapper>
  );
}

/** An image shown in the note at up to its own size; a picture the browser cannot draw (HEIC) becomes a tile. */
function NoteImage({ file, onOpen }: { file: NoteFile; onOpen: () => void }) {
  const url = useSignedUrl(BUCKET, file.path);
  const [broken, setBroken] = useState(false);
  if (broken || url === null) return <AttachmentTile attachment={noteAttachment(file)} onOpen={onOpen} className="size-32" />;
  if (!url) return <Skeleton className="aspect-video w-full max-w-md rounded-lg" />;
  return (
    <button type="button" onClick={onOpen} aria-label={`Open ${file.name}`} className="block max-w-full cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={file.name} decoding="async" onError={() => setBroken(true)} className="max-h-[480px] max-w-full rounded-lg border object-contain" />
    </button>
  );
}
