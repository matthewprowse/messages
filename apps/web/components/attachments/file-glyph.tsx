"use client";

// The tile for a file that has no picture: the file type's icon, its extension and (large) its size. Also used by the
// viewer when a file has no preview.

import { CalendarDays, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, type LucideIcon } from "lucide-react";
import type { Attachment } from "@/lib/types";
import { KIND_LABEL, extensionOf } from "@/lib/attachment-view";
import { cn } from "@/lib/utils";

function iconFor(a: Attachment): LucideIcon {
  const ext = extensionOf(a.name).toLowerCase();
  if (a.kind === "image") return FileImage;
  if (a.kind === "video") return FileVideo;
  if (a.kind === "audio") return FileAudio;
  if (a.kind === "pdf" || ["doc", "docx", "rtf", "txt", "odt", "pages", "md"].includes(ext)) return FileText;
  if (["xls", "xlsx", "csv", "numbers", "ods"].includes(ext)) return FileSpreadsheet;
  if (["ppt", "pptx", "key", "odp"].includes(ext)) return Presentation;
  if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return FileArchive;
  if (["mp3", "m4a", "wav", "aac", "ogg"].includes(ext)) return FileAudio;
  if (ext === "ics") return CalendarDays;
  return File;
}

/** A clean tile for files without a picture: the file type's icon, its extension and size. */
export function FileGlyph({ attachment: a, large }: { attachment: Attachment; large?: boolean }) {
  const Icon = iconFor(a);
  const ext = extensionOf(a.name) || KIND_LABEL[a.kind];
  return (
    <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
      <Icon className={large ? "size-12" : "size-7"} strokeWidth={1.5} />
      <span className={cn("font-medium", large ? "text-sm" : "text-[11px]")}>{ext}</span>
      {large && <span className="text-xs">{a.size}</span>}
    </span>
  );
}
