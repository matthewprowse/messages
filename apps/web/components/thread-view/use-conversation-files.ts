// The files of an open conversation and the one viewer shared by every bubble's attachment: which file is open, who sent
// it and when, and the Next and Previous order.

import { useMemo, useState } from "react";
import type { Attachment, Contact, FiledAttachment, Message } from "@/lib/types";
import { fullStamp } from "@/lib/format";
import { isSticker } from "@/components/attachments";

export function useConversationFiles(msgs: Message[], contactById: (id: string) => Contact | undefined) {
  // One viewer for the whole conversation, opened by any bubble's attachment.
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const files = useMemo(
    () => msgs.flatMap((m) => (m.attachments ?? []).map<FiledAttachment>((a) => ({ ...a, messageId: m.id, threadId: m.threadId, sentAt: m.sentAt, from: m.from }))).reverse(),
    [msgs],
  );
  // Who sent the open file, and when, for the top of the viewer; and its place among the conversation's files.
  // Next and Previous stay among the pictures while one is open, rather than running on into stickers, voice notes and documents.
  const isPicture = (f: Attachment) => f.kind === "image" && !isSticker(f);
  const viewerItems = useMemo(() => (viewing && isPicture(viewing) ? files.filter(isPicture) : files), [files, viewing]);
  const viewerAt = viewing ? viewerItems.findIndex((f) => f.id === viewing.id) : -1;
  const viewerFile = viewerAt >= 0 ? viewerItems[viewerAt] : undefined;
  const viewerDetail = viewerFile ? `${viewerFile.from === "me" ? "You" : contactById(viewerFile.from)?.name ?? "Unknown"} · ${fullStamp(viewerFile.sentAt)}` : undefined;
  return { files, viewing, setViewing, viewerItems, viewerAt, viewerFile, viewerDetail };
}
