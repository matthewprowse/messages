"use client";

// A WhatsApp sticker drawn the way WhatsApp does: the picture alone, with no tile, frame or name.

import { useRef } from "react";
import { mimeFor, useSignedUrl } from "@/lib/signed-urls";
import { ATTACHMENT_BUCKET as BUCKET } from "@/lib/attachment-view";
import type { Attachment } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useSeen } from "./use-seen";

/** A sticker as WhatsApp shows it: the picture alone, about 120px, with no tile, frame or name. */
export function StickerImage({ attachment: a, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const seen = useSeen(box);
  const url = useSignedUrl(BUCKET, seen ? a.path : undefined, false, a.sealed ? mimeFor(a) : undefined);
  return (
    <button ref={box} type="button" onClick={onOpen} aria-label="Open Sticker" className="size-30 overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="Sticker" decoding="async" className="size-full rounded-lg object-contain" /> : <Skeleton className="size-full rounded-lg" />}
    </button>
  );
}
