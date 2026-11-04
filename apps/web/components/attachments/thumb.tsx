"use client";

// The picture inside a tile: the image itself, a PDF's first page, or the file type's icon. A sealed photo or PDF shows
// its small sealed thumbnail and, until the worker has made one, the file icon: a tile never downloads the whole file.

import { useCallback, useEffect, useRef, useState } from "react";
import { mimeFor, isBrowserSealedPath, isTeamFilePath, reportThumb, thumbsEnabled, useSignedUrl, useThumbUrl } from "@/lib/signed-urls";
import { ATTACHMENT_BUCKET as BUCKET } from "@/lib/attachment-view";
import type { Attachment } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { PdfThumbnail } from "@/components/pdf-viewer";
import { FileGlyph } from "./file-glyph";
import { useSeen } from "./use-seen";

/** The picture inside a tile: the image itself, a PDF's first page, or the file type's icon. */
export function Thumb({ attachment: a, onReady }: { attachment: Attachment; /** Called with "picture" once a picture has loaded, or "glyph" when the tile shows the file type's icon. */ onReady?: (kind: "picture" | "glyph") => void }) {
  // A sealed photo or PDF is encrypted, so Storage cannot resize it: the worker stores a small sealed copy beside it. Until that
  // exists the tile shows the file icon rather than downloading and decrypting the whole file to draw 96 pixels. Note files
  // and outgoing files (sealed in the browser) and a team's copies (no thumbnail is made for them) are still opened whole.
  const lazySealed = !!a.sealed && !isBrowserSealedPath(a.path) && !isTeamFilePath(a.path) && (a.kind === "image" || a.kind === "pdf");
  const pictured = !!a.path && (a.kind === "image" || a.kind === "pdf") && !(lazySealed && !a.thumbPath);
  // Links are only asked for, and images only downloaded, once a tile scrolls near the screen.
  // The browser's own lazy loading is not used: it does not fire in every webview.
  const box = useRef<HTMLSpanElement>(null);
  const seen = useSeen(box);
  // Unsealed images load as small resized copies. If that will not work, the original is tried before giving up.
  const hasThumb = lazySealed && !!a.thumbPath;
  const [stage, setStage] = useState<"thumb" | "small" | "original">(hasThumb ? "thumb" : "small");
  const fellBack = useRef(false);
  // Note files and sealed attachments are encrypted, so Storage cannot resize them: without a thumbnail the picture comes from the opened file.
  const small = a.kind === "image" && stage === "small" && thumbsEnabled() && !isBrowserSealedPath(a.path) && !a.sealed;
  const sealedThumb = stage === "thumb" && hasThumb;
  const thumbUrl = useThumbUrl(a.id, sealedThumb && seen ? a.thumbPath : undefined);
  // The thumbnail could not be opened: the tile keeps the file icon.
  const thumbFailed = sealedThumb && seen && thumbUrl === null;
  const fullUrl = useSignedUrl(BUCKET, pictured && seen && !sealedThumb ? a.path : undefined, small, a.sealed ? mimeFor(a) : undefined);
  const url = sealedThumb ? (thumbFailed ? undefined : thumbUrl) : fullUrl;
  const [broken, setBroken] = useState(false);
  const onError = useCallback(() => setBroken(true), []);
  useEffect(() => { setBroken(false); }, [url]); // a different file gets its own chance to load
  const glyph = !pictured || broken || thumbFailed || (seen && url === null);
  useEffect(() => { if (glyph) onReady?.("glyph"); }, [glyph, onReady]);
  if (glyph) return <FileGlyph attachment={a} />;
  if (!url) return <span ref={box} className="size-full"><Skeleton className="size-full rounded-none" /></span>;
  if (a.kind === "pdf" && !sealedThumb) return <PdfThumbnail cacheKey={a.id} url={url} name={a.name} onError={onError} onReady={() => onReady?.("picture")} />; // pdf.js loads here, once on screen
  // Images some browsers cannot draw (HEIC outside Safari) fall back to the icon.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      decoding="async"
      onLoad={() => {
        onReady?.("picture");
        if (small) reportThumb("loaded");
        else if (fellBack.current) { fellBack.current = false; reportThumb("fell-back"); }
      }}
      onError={() => {
        if (sealedThumb) onError();
        else if (small) { fellBack.current = true; setStage("original"); }
        else onError();
      }}
      className="size-full object-cover"
    />
  );
}
