"use client";

// Entry point for signed links to private files. The parts live in signed-urls/: links.ts (signing, batching, cache),
// sealed-files.ts (fetching and decrypting sealed files and thumbnails), hooks.ts (React hooks) and the pure rules
// beside them. This file only keeps the public names other modules import.

export { mimeFor } from "./file-types";
export { thumbsEnabled, reportThumb, signedUrl, downloadUrl, clearSignedUrls } from "./signed-urls/links";
export { isNotePath, isBrowserSealedPath, sealedField, isTeamFilePath } from "./signed-urls/sealed-paths";
export { rememberNoteMime, acquireNoteFile, openThumb, cachedThumb, type OpenedNoteFile } from "./signed-urls/sealed-files";
export { useThumbUrl, useSignedUrl } from "./signed-urls/hooks";
