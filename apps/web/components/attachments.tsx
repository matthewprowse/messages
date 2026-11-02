"use client";

// Entry point for showing files: tiles, the full-screen viewer and the grid used by the Attachments page, a contact's
// page and a conversation. The parts live in components/attachments/ and the pure helpers in lib/attachment-view.ts;
// this file only keeps the public names other screens import.

export { KIND_LABEL, HIDDEN_LABEL, isSticker, messageHref, filesLabel } from "@/lib/attachment-view";
export { StickerImage } from "./attachments/sticker-image";
export { AttachmentTile } from "./attachments/tile";
export { AttachmentViewer } from "./attachments/viewer";
export { AttachmentGrid } from "./attachments/grid";
