"use client";

// React hooks over the signed link cache and the sealed file opener: a link to a stored file, a sealed photo's
// thumbnail, and a note file held open while a component is mounted.

import { useEffect, useState } from "react";
import { BUCKET } from "../outbox-files";
import { cachedUrl, MIN_LEFT_MS, signedUrl, thumbsEnabled } from "./links";
import { keyOf } from "./cache-rules";
import { isBrowserSealedPath } from "./sealed-paths";
import { acquireNoteFile, cachedThumb, openThumb, rememberNoteMime, type OpenedNoteFile } from "./sealed-files";

/**
 * A sealed photo's thumbnail: undefined while opening, null when there is none or it cannot be opened (the tile then
 * uses the whole file). Pass no path to stay idle.
 */
export function useThumbUrl(id: string, thumbPath: string | undefined): string | null | undefined {
  const [got, setGot] = useState<{ id: string; path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!thumbPath || cachedThumb(id)) return;
    let live = true;
    void openThumb(id, thumbPath).then((url) => { if (live) setGot({ id, path: thumbPath, url }); });
    return () => { live = false; };
  }, [id, thumbPath]);
  if (!thumbPath) return null;
  return cachedThumb(id) ?? (got?.id === id && got.path === thumbPath ? got.url : undefined);
}

/** A note file opened for as long as the component is mounted: undefined while opening, null when it cannot be. */
function useNoteFile(path: string | undefined): OpenedNoteFile | null | undefined {
  const [got, setGot] = useState<{ path: string; file: OpenedNoteFile | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const handle = acquireNoteFile(path);
    // A file too big to open here has no link, which a tile treats like a file that cannot be opened.
    void handle.promise.then((file) => { if (live) setGot({ path, file: file?.tooLarge ? null : file }); });
    return () => { live = false; handle.release(); };
  }, [path]);
  if (!path) return null;
  return got?.path === path ? got.file : undefined;
}

/**
 * A link to a stored file: undefined while asking, null when there is no path or no file. With thumb, a
 * small resized copy for grid tiles (the full file when the project cannot resize images).
 */
export function useSignedUrl(bucket: string, path: string | undefined, thumb = false, sealedType?: string): string | null | undefined {
  // sealedType is the content type of a stored attachment known to be sealed, which is opened here like a note file.
  if (path && sealedType) rememberNoteMime(path, sealedType);
  const note = bucket === BUCKET && (isBrowserSealedPath(path) || (!!path && !!sealedType));
  const opened = useNoteFile(note ? path : undefined);
  const small = thumb && thumbsEnabled() && !note;
  const [got, setGot] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path || note) return;
    let live = true;
    signedUrl(bucket, path, MIN_LEFT_MS, small).then((url) => { if (live) setGot({ key: keyOf(bucket, path, small), url }); });
    return () => { live = false; };
  }, [bucket, path, small, note]);
  if (!path) return null;
  // Note files are opened here, not signed: sealed ones come back as a blob link.
  if (note) return opened === undefined ? undefined : opened?.url ?? null;
  return got?.key === keyOf(bucket, path, small) ? got.url : cachedUrl(bucket, path, small);
}
