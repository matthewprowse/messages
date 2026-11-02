"use client";

// The picture inside a tile: the image itself, a PDF's first page, or the file type's icon. Walks from the sealed
// thumbnail to a resized copy to the original as each fails to load.

import { useCallback, useEffect, useRef, useState } from "react";
import { mimeFor, isNotePath, reportThumb, thumbsEnabled, useSignedUrl, useThumbUrl } from "@/lib/signed-urls";
import { ATTACHMENT_BUCKET as BUCKET } from "@/lib/attachment-view";
import type { Attachment } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { PdfThumbnail } from "@/components/pdf-viewer";
import { FileGlyph } from "./file-glyph";
import { useSeen } from "./use-seen";

/** The picture inside a tile: the image itself, a PDF's first page, or the file type's icon. */
export function Thumb({ attachment: a, onReady }: { attachment: Attachment; /** Called with "picture" once a picture has loaded, or "glyph" when the tile shows the file type's icon. */ onReady?: (kind: "picture" | "glyph") => void }) {
  const pictured = !!a.path && (a.kind === "image" || a.kind === "pdf");
  // Links are only asked for, and images only downloaded, once a tile scrolls near the screen.
  // The browser's own lazy loading is not used: it does not fire in every webview.
  const box = useRef<HTMLSpanElement>(null);
  const seen = useSeen(box);
  // A sealed photo with a stored thumbnail opens that small sealed copy; other images load as small resized copies. If one
  // will not load that way, the original is tried before giving up.
  const hasThumb = a.kind === "image" && !!a.sealed && !!a.thumbPath && !isNotePath(a.path);
  const [stage, setStage] = useState<"thumb" | "small" | "original">(hasThumb ? "thumb" : "small");
  const fellBack = useRef(false);
  // Note files and sealed attachments are encrypted, so Storage cannot resize them: without a thumbnail the picture comes from the opened file.
  const small = a.kind === "image" && stage === "small" && thumbsEnabled() && !isNotePath(a.path) && !a.sealed;
  const sealedThumb = stage === "thumb" && hasThumb;
  const thumbUrl = useThumbUrl(a.id, sealedThumb && seen ? a.thumbPath : undefined);
  // The thumbnail could not be opened: the whole file is used instead.
  const thumbFailed = sealedThumb && seen && thumbUrl === null;
  useEffect(() => { if (thumbFailed) setStage("original"); }, [thumbFailed]);
  const fullUrl = useSignedUrl(BUCKET, pictured && seen && !sealedThumb ? a.path : undefined, small, a.sealed ? mimeFor(a) : undefined);
  const url = sealedThumb ? (thumbFailed ? undefined : thumbUrl) : fullUrl;
  const [broken, setBroken] = useState(false);
  const onError = useCallback(() => setBroken(true), []);
  useEffect(() => { setBroken(false); }, [url]); // a different file gets its own chance to load
  const glyph = !pictured || broken || (seen && url === null);
  useEffect(() => { if (glyph) onReady?.("glyph"); }, [glyph, onReady]);
  if (glyph) return <FileGlyph attachment={a} />;
  if (!url) return <span ref={box} className="size-full"><Skeleton className="size-full rounded-none" /></span>;
  if (a.kind === "pdf") return <PdfThumbnail cacheKey={a.id} url={url} name={a.name} onError={onError} onReady={() => onReady?.("picture")} />; // pdf.js loads here, once on screen
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
        if (sealedThumb) setStage("original");
        else if (small) { fellBack.current = true; setStage("original"); }
        else onError();
      }}
      className="size-full object-cover"
    />
  );
}
