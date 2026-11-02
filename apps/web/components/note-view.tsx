"use client";

// An open note, laid out like a conversation: a header, then the toolbar, then the note in the same 672px
// column as chat bubbles. Files picked, dropped or pasted show in the note at once and fill in as they upload.

import { exportNotePdf } from "@/components/note-export";
import { loadPdfJs } from "@/lib/pdf";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EditorContent, type Editor } from "@tiptap/react";
import { ArrowLeft, MoreHorizontal, NotebookPen } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { relTime } from "@/lib/format";
import { displayName, mimeOf, pastedName, UploadError } from "@/lib/outbox-files";
import { noteAttachment, noteFileError, removeNoteFiles, takeNoteFiles, uploadNoteFile, type Note, type NoteFile } from "@/lib/notes";
import { noteReady, useNotes, useSaveState } from "@/components/notes-data";
import { NoteConflictBar } from "@/components/note-conflict";
import { DraftsBadge, useDraftFacts } from "@/components/note-drafts-badge";
import { factStatus } from "@/lib/note-facts";
import { NoteToolbar, useKeyboardInset, useNoteEditor } from "@/components/note-editor";
import { NoteFilesContext, type NoteFilesValue } from "@/components/note-file-node";
import { DeleteNoteDialog } from "@/components/note-list";
import { AttachmentViewer } from "@/components/attachments";
import { EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const MAX_FILES_AT_ONCE = 20;
// Kinds of image every browser draws, shown in the note itself; others (HEIC) show as a file.
const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/;
const closing = new Map<string, ReturnType<typeof setTimeout>>();

type Upload = { file: File; name: string; image: boolean; key: string };

export function NoteView({ noteId }: { noteId: string }) {
  const { noteById, loading, ensureBody } = useNotes();
  const note = noteById(noteId);
  const unloaded = !!note?.unloaded;
  // A note's text is downloaded when the note is opened, ahead of the rest of the list.
  useEffect(() => { if (unloaded) void ensureBody(noteId); }, [unloaded, noteId, ensureBody]);
  if (!note || note.unloaded) {
    if (note?.failed) return <EmptyState icon={NotebookPen} title="Could Not Open Note" description="Check your connection and try again." action={<Button variant="link" size="sm" onClick={() => void ensureBody(noteId)}>Try Again</Button>} />;
    if (loading || note) return <NoteSkeleton />;
    return <EmptyState icon={NotebookPen} title="Note Not Found" description="It may have been deleted." action={<Button variant="secondary" asChild><Link href="/notes">Back to Notes</Link></Button>} />;
  }
  // A new revision means the text was replaced from outside the editor (the other version was taken): it opens afresh.
  return <OpenNote key={`${noteId}:${note.revision ?? 0}`} note={note} />;
}

function OpenNote({ note }: { note: Note }) {
  const { edit, flush, close, pin, draftWith, upgrade, notes } = useNotes();
  const state = useSaveState(note.id);
  const facts = useDraftFacts(notes);
  const router = useRouter();
  const params = useSearchParams();
  const id = note.id;
  const [files, setFiles] = useState<Map<string, NoteFile>>(new Map());
  const [loaded, setLoaded] = useState(false);
  // Settles with the note's files once listed, or null if they could not be: closing waits for it, so a note is
  // never judged empty or its files judged unused before they are known.
  const filesKnown = useRef<Promise<NoteFile[] | null>>(Promise.resolve(null));
  const [uploads, setUploads] = useState<Map<string, number>>(new Map());
  const [viewing, setViewing] = useState<NoteFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const keyboard = useKeyboardInset();
  // Files whose upload stopped, kept so Try Again can send them.
  const stopped = useRef(new Map<string, Upload>());
  const filesRef = useRef(files);
  filesRef.current = files;
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const openRef = useRef(true);
  useEffect(() => {
    openRef.current = true;
    return () => { openRef.current = false; };
  }, []);
  const pickerRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [initialBody] = useState(note.body);

  // A note saved before excerpts, or before notes were always encrypted, is rewritten sealed once opened.
  useEffect(() => { void upgrade(id); }, [id, upgrade]);

  useEffect(() => {
    let cancelled = false;
    const listed = takeNoteFiles(id).then((list): NoteFile[] | null => list).catch(() => null);
    filesKnown.current = listed;
    void listed.then((list) => {
      if (cancelled) return;
      if (list) {
        setFiles(new Map(list.map((f) => [f.id, f])));
        // pdf.js and its worker load while the file downloads, so a PDF in the note draws as soon as it arrives.
        if (list.some((f) => f.mimeType === "application/pdf")) void loadPdfJs().catch(() => {});
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [id]);

  // Closing the note saves it, drops it if it was left empty, and deletes files taken out of it. Files
  // are kept while it is open, so Undo can bring one back. Closing waits a moment, so a note mounted
  // again at once (React's development double mount) is not taken for closed.
  useEffect(() => {
    clearTimeout(closing.get(id));
    return () => {
      void flush(id);
      closing.set(id, setTimeout(() => {
        closing.delete(id);
        // A file still uploading is not in the markdown yet, so the note would look empty: leave it be. Files not
        // listed yet are waited for, and a list that failed means nothing is judged (null).
        void filesKnown.current.then((list) => {
          if (uploadsRef.current.size > 0) return;
          const fresh = list ? [...new Map([...list, ...filesRef.current.values()].map((f) => [f.id, f])).values()] : null;
          close(id, fresh);
        });
      }, 0));
    };
  }, [id, flush, close]);

  const startUpload = useCallback((item: Upload) => {
    stopped.current.delete(item.key);
    setUploads((m) => new Map(m).set(item.key, 0));
    const progress = (fraction: number) => setUploads((m) => new Map(m).set(item.key, fraction));
    noteReady(id).then(() => uploadNoteFile(id, item.file, item.name, progress))
      .then((saved) => {
        // The note was closed meanwhile, so the file is in no saved text: delete it rather than leave it unreachable.
        if (!openRef.current) { void removeNoteFiles([saved]).catch(() => {}); return; }
        setFiles((m) => new Map(m).set(saved.id, saved));
        track("feature_used", { feature: "note_file_attached", detail: noteAttachment(saved).kind });
        replaceUpload(editorRef.current, item.key, saved.id);
      })
      .catch((e) => {
        // The block stays, offering Try Again.
        stopped.current.set(item.key, item);
        toast.error(`${item.name} did not upload. ${e instanceof UploadError ? e.message : "Try again."}`);
      })
      .finally(() => setUploads((m) => { const next = new Map(m); next.delete(item.key); return next; }));
  }, [id]);

  const addFiles = useCallback((list: File[], at: number | null, pasted: boolean) => {
    const editor = editorRef.current;
    if (!editor || list.length === 0) return;
    if (list.length > MAX_FILES_AT_ONCE) toast.error(`Attach up to ${MAX_FILES_AT_ONCE} files at a time.`);
    const taken: string[] = [];
    const items = list.slice(0, MAX_FILES_AT_ONCE).flatMap((file) => {
      const problem = noteFileError(file);
      if (problem) { toast.error(problem); return []; }
      const mime = mimeOf(file.name, file.type);
      const name = pasted && (!file.name || /^image\.\w+$/i.test(file.name)) ? pastedName(mime, taken) : displayName(file.name);
      taken.push(name);
      return [{ file, name, image: INLINE_IMAGE.test(mime), key: crypto.randomUUID() }];
    });
    if (items.length === 0) return;
    const nodes = items.map((i) => ({ type: "noteFile", attrs: { id: null, name: i.name, image: i.image, upload: i.key } }));
    const chain = editor.chain().focus();
    (at === null ? chain.insertContent(nodes) : chain.insertContentAt(at, nodes)).run();
    for (const item of items) startUpload(item);
  }, [startUpload]);

  const editor = useNoteEditor({ markdown: initialBody, onChange: (read) => edit(id, { body: read }), onFiles: addFiles });
  editorRef.current = editor;

  // A note just made from New Note starts in its title.
  useEffect(() => {
    if (params.get("new") === "1") {
      titleRef.current?.focus();
      router.replace(`/notes/${id}`, { scroll: false });
    }
  }, [params, router, id]);

  const filesValue = useMemo<NoteFilesValue>(() => ({
    files,
    loaded,
    uploads,
    open: setViewing,
    canRetry: (key) => stopped.current.has(key),
    retry: (key) => { const item = stopped.current.get(key); if (item) startUpload(item); },
  }), [files, loaded, uploads, startUpload]);
  const offline = useOffline();
  const status = state === "conflict" ? "Changed Elsewhere"
    : state === "failed" ? (offline ? "Offline, Will Save When Back Online" : "Not Saved, Retrying")
    : state === "saving" ? "Saving" : state === "saved" ? "Saved" : `Edited ${relTime(note.updatedAt)}`;
  const drafts = factStatus(facts, note);
  const attach = () => pickerRef.current?.click();
  const exportPdf = () => void exportNotePdf(editorRef.current, note.title, () => filesRef.current);

  // Esc and Cmd+Enter leave the note for the list (saving it), and Cmd+Shift+P pins it, without reaching for the mouse.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    // Menus and dialogs opened from here bubble their keys through React too: only the title and the text count.
    if (!(e.target as HTMLElement).closest("input, [contenteditable=true]")) return;
    if ((e.key === "Escape" && !e.defaultPrevented) || (mod && e.key === "Enter")) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      void flush(id);
      document.querySelector<HTMLElement>("[data-row-link][aria-current=page]")?.focus({ preventScroll: true });
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      pin(id, !note.pinned);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <header className="flex h-[57px] shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back">
          <Link href="/notes"><ArrowLeft /></Link>
        </Button>
        {/* The title field below carries the name for screen readers, so this copy is hidden from them. */}
        <h1 aria-hidden className="min-w-0 flex-1 truncate text-sm font-medium">{note.title.trim() || "Untitled Note"}</h1>
        <DraftsBadge status={drafts} />
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span className={state === "failed" || state === "conflict" ? "text-destructive" : undefined}>{status}</span>
          {state === "failed" && <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => void flush(id)}>Try Again</Button>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="secondary" size="icon" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max">
            <DropdownMenuItem onClick={() => pin(id, !note.pinned)}>{note.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={note.useInDrafts} onCheckedChange={(on) => draftWith(id, on)}>Use in Drafts</DropdownMenuCheckboxItem>
            <DropdownMenuItem onClick={attach}>Attach Files</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void exportPdf()}>Export as PDF</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {state === "conflict" && <NoteConflictBar id={id} />}

      {/* Padding sits outside the 672px column, as in a conversation, so the note lines up with the bubbles. */}
      {/* On phones the toolbar is pinned just above the on-screen keyboard (or the screen's bottom edge). */}
      <div
        className={cn(
          "bg-background p-3 md:static md:z-auto md:shrink-0 md:border-b md:px-4",
          "max-md:fixed max-md:inset-x-0 max-md:z-30 max-md:border-t",
          keyboard === 0 && "max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        )}
        style={{ bottom: keyboard }}
      >
        <div className="@container mx-auto w-full max-w-2xl">
          {editor ? <NoteToolbar editor={editor} onAttach={attach} /> : <Skeleton className="h-8 w-full max-w-md" />}
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1"
        onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) setDragging(true); }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={() => setDragging(false)}
      >
      {dragging && <div aria-hidden className="pointer-events-none absolute inset-2 z-10 rounded-lg ring-2 ring-ring/50" />}
      <ScrollArea className="h-full">
        <div className="p-3 md:px-4">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 pb-24">
            <input
              ref={titleRef}
              value={note.title}
              onChange={(e) => edit(id, { title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) {
                  e.preventDefault();
                  editor?.commands.focus("start");
                }
              }}
              placeholder="Title"
              aria-label="Title"
              className="w-full bg-transparent py-1 text-2xl font-semibold outline-none placeholder:text-muted-foreground/60"
            />
            <NoteFilesContext.Provider value={filesValue}>
              {editor ? <EditorContent editor={editor} /> : <Skeleton className="h-24 w-full" />}
            </NoteFilesContext.Provider>
          </div>
        </div>
      </ScrollArea>
      </div>

      <input
        ref={pickerRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []), null, false);
          e.target.value = "";
        }}
      />
      <AttachmentViewer attachment={viewing ? noteAttachment(viewing) : null} detail={note.title.trim() || undefined} onClose={() => setViewing(null)} />
      <DeleteNoteDialog note={deleting ? note : null} onClose={() => setDeleting(false)} onDeleted={() => router.push("/notes")} />
    </div>
  );
}

/** Fills in a file's id once it has uploaded, or takes its block out when the upload failed. Not undoable. */
function replaceUpload(editor: Editor | null, key: string, fileId: string | null) {
  if (!editor || editor.isDestroyed) return;
  const { state } = editor;
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at !== -1) return false;
    if (node.type.name === "noteFile" && node.attrs.upload === key) at = pos;
    return true;
  });
  if (at === -1) return;
  const node = state.doc.nodeAt(at)!;
  const tr = fileId ? state.tr.setNodeMarkup(at, undefined, { ...node.attrs, id: fileId, upload: null }) : state.tr.delete(at, at + node.nodeSize);
  editor.view.dispatch(tr.setMeta("addToHistory", false));
}

/** Whether the browser says the device is offline. */
function useOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return offline;
}

function NoteSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy aria-label="Loading Note">
      <div className="flex shrink-0 items-center gap-3 border-b p-3 md:px-4">
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="ml-auto size-8 rounded-md" />
      </div>
      <div className="shrink-0 border-b px-3 py-2 md:px-4">
        <div className="mx-auto w-full max-w-2xl"><Skeleton className="h-8 w-full max-w-md" /></div>
      </div>
      <div className="min-h-0 flex-1 p-3 md:px-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
