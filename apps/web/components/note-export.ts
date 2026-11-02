// Exports an open note as a PDF, made in the browser and downloaded. The PDF writer is loaded only now, so it
// stays out of the Notes page's first load. Not put back into the note. Pictures are shrunk to what a page can show.

import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { acquireNoteFile } from "@/lib/signed-urls";
import type { NoteFile } from "@/lib/notes";

export async function exportNotePdf(editor: Editor | null, title: string, files: () => Map<string, NoteFile>) {
  if (!editor) return;
  const toastId = toast.loading("Making PDF");
  try {
    const [{ notePdf, pdfName }, { jpegPicture }] = await Promise.all([import("@/lib/note-pdf"), import("@/lib/note-pdf-images")]);
    const bytes = await notePdf(title, editor.getJSON(), async (fileId) => {
      const stored = files().get(fileId);
      if (!stored?.path) return null;
      const handle = acquireNoteFile(stored.path);
      try {
        const opened = await handle.promise;
        return opened ? await jpegPicture(opened.url) : null;
      } finally {
        handle.release();
      }
    });
    const name = pdfName(title);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast.success(`${name} is downloaded`, { id: toastId });
    track("feature_used", { feature: "note_exported", detail: "pdf" });
  } catch {
    toast.error("The PDF could not be made. Try again.", { id: toastId });
  }
}
