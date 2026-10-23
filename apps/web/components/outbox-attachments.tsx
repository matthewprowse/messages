"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { File as FileIcon, Paperclip, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  MAX_FILES,
  UploadError,
  displayName,
  formatBytes,
  limitError,
  mimeOf,
  outboxPath,
  pastedName,
  shouldTakePastedFiles,
  uploadFile,
  uploadMessage,
  type AttachProvider,
  type OutboxUpload,
} from "@/lib/outbox-files";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Item {
  id: string;
  file: File;
  name: string;
  size: number;
  mimeType: string;
  preview?: string; // a local link for an image's thumbnail
  progress?: number; // 0 to 1 while uploading
  path?: string; // set once uploaded, so a retry does not upload it again
  error?: string;
}

export type OutboxFiles = ReturnType<typeof useOutboxFiles>;

/**
 * Files attached in the reply box or the New Email dialog: picked, dropped or pasted, checked against the
 * service's limits, and uploaded when the message is sent. Nothing is uploaded until then.
 */
export function useOutboxFiles(provider: AttachProvider | null, disabled = false) {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => () => { for (const i of itemsRef.current) if (i.preview) URL.revokeObjectURL(i.preview); }, []);

  const add = useCallback((files: File[], pasted = false) => {
    if (!provider || disabled || uploading || files.length === 0) return;
    const next = [...itemsRef.current];
    let problem: string | null = null;
    for (const file of files) {
      if (next.length >= MAX_FILES) { problem = `Attach up to ${MAX_FILES} files per message.`; break; }
      if (file.size === 0) { problem = `${displayName(file.name)} is empty.`; continue; }
      const mimeType = mimeOf(file.name, file.type);
      // Pasted screenshots arrive as "image.png" with no real name.
      const name = pasted && (!file.name || /^image\.\w+$/i.test(file.name)) ? pastedName(mimeType, next.map((i) => i.name)) : displayName(file.name);
      next.push({
        id: crypto.randomUUID(),
        file,
        name,
        size: file.size,
        mimeType,
        preview: mimeType.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      });
    }
    setNotice(problem);
    setItems(next);
  }, [provider, disabled, uploading]);

  const remove = useCallback((id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setNotice(null);
  }, []);

  const clear = useCallback(() => {
    for (const i of itemsRef.current) if (i.preview) URL.revokeObjectURL(i.preview);
    setItems([]);
    setNotice(null);
  }, []);

  const patch = useCallback((id: string, p: Partial<Item>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, []);

  /**
   * Uploads every file not yet uploaded, showing progress on each. Resolves to the uploaded files in
   * order, or null when any failed (the failed ones say why; the rest are kept for the next try).
   */
  const upload = useCallback(async (): Promise<OutboxUpload[] | null> => {
    const list = itemsRef.current;
    if (list.length === 0) return [];
    setUploading(true);
    setNotice(null);
    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) {
        setNotice("Sign in again to send files.");
        return null;
      }
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
      const paths = await Promise.all(list.map(async (item) => {
        if (item.path) return item.path;
        const path = outboxPath(session.user.id, crypto.randomUUID(), item.name);
        patch(item.id, { progress: 0, error: undefined });
        try {
          await uploadFile({ base, apiKey, token: session.access_token, path, file: item.file, mimeType: item.mimeType, onProgress: (progress) => patch(item.id, { progress }) });
          patch(item.id, { path, progress: undefined });
          return path;
        } catch (e) {
          patch(item.id, { progress: undefined, error: e instanceof UploadError ? e.message : uploadMessage(0) });
          return null;
        }
      }));
      if (paths.some((p) => !p)) {
        setNotice(paths.length === 1 ? "The file did not upload. Try sending again." : "Some files did not upload. Try sending again.");
        return null;
      }
      return list.map((item, i) => ({ path: paths[i]!, filename: item.name, mimeType: item.mimeType, size: item.size }));
    } catch {
      setNotice("The files did not upload. Check your connection and try again.");
      return null;
    } finally {
      setUploading(false);
    }
  }, [patch]);

  const hasFiles = (e: React.DragEvent) => !!provider && Array.from(e.dataTransfer.types).includes("Files");
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = disabled || uploading ? "none" : "copy";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // otherwise the browser opens the file
      depth.current = 0;
      setDragging(false);
      add(Array.from(e.dataTransfer.files));
    },
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (!provider) return;
    const files = Array.from(e.clipboardData.files);
    if (!shouldTakePastedFiles(Array.from(e.clipboardData.types), files.length)) return;
    e.preventDefault();
    add(files, true);
  };

  const limit = useMemo(() => (provider ? limitError(provider, items) : null), [provider, items]);
  return { provider, items, add, remove, clear, upload, uploading, dragging, dropProps, onPaste, error: limit || notice, blocked: !!limit, disabled };
}

/** The Paperclip button that opens the file picker. Hidden where files cannot be sent. */
export function AttachButton({ files, className }: { files: OutboxFiles; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  if (!files.provider) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={className}
        aria-label="Attach Files"
        title="Attach Files"
        disabled={files.disabled || files.uploading}
        onClick={() => input.current?.click()}
      >
        <Paperclip />
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          files.add(Array.from(e.target.files ?? []));
          e.target.value = ""; // so the same file can be picked again after removing it
        }}
      />
    </>
  );
}

/** One chip per file, with its thumbnail or icon, name, size or upload progress, and a remove button. */
export function AttachmentChips({ files }: { files: OutboxFiles }) {
  if (files.items.length === 0 && !files.error) return null;
  return (
    <div className="grid min-w-0 gap-2">
      {files.items.length > 0 && (
        <ul className="flex min-w-0 flex-wrap gap-2" aria-label="Attachments">
          {files.items.map((item) => (
            <Chip key={item.id} item={item} locked={files.disabled || files.uploading} onRemove={() => files.remove(item.id)} />
          ))}
        </ul>
      )}
      {files.error && <p className="text-xs text-destructive" role="alert">{files.error}</p>}
    </div>
  );
}

function Chip({ item, locked, onRemove }: { item: Item; locked: boolean; onRemove: () => void }) {
  const [broken, setBroken] = useState(false); // images some browsers cannot draw, such as HEIC
  const uploadingNow = item.progress !== undefined;
  return (
    <li className="flex w-56 max-w-full min-w-0 items-center gap-2 rounded-md border bg-background p-1.5">
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
        {item.preview && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.preview} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <FileIcon className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium" title={item.name}>{item.name}</span>
        {item.error ? (
          <span className="block truncate text-xs text-destructive">{item.error}</span>
        ) : uploadingNow ? (
          <Progress value={Math.round((item.progress ?? 0) * 100)} className="mt-2" aria-label={`Uploading ${item.name}`} />
        ) : (
          <span className="block text-xs text-muted-foreground">{formatBytes(item.size)}</span>
        )}
      </span>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${item.name}`} title="Remove" disabled={locked} onClick={onRemove}>
        <X />
      </Button>
    </li>
  );
}
