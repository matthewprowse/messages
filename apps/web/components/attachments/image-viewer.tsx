"use client";

// The viewer's picture: zooms (buttons, wheel, double click, pinch, plus and minus keys), rotates and pans by dragging.
// A swipe while it is not zoomed goes to the neighbouring file.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { swipeOf } from "@/lib/attachment-view";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { STAGE_HEIGHT } from "@/components/media-player";

// The tallest a picture is shown, and the widest it can be inside the dialog (its max width less its padding and margins).
const STAGE = "min(65dvh, 100dvh - 14rem)";
const STAGE_WIDTH = "min(46rem, 100vw - 4rem)";

const IMAGE_MAX_ZOOM = 8;

/**
 * An image that zooms (buttons, wheel, double click, pinch, plus and minus keys) and pans by dragging.
 * A swipe while it is not zoomed goes to the neighbouring file.
 */
export function ImageViewer({ url, name, preview, onRatio, onBroken, onSwipe }: { url: string; name: string; /** A small copy to show until the full picture has arrived. */ preview?: string | null; /** The picture's width over its height, once known, so the dialog can hug it. */ onRatio?: (ratio: number) => void; onBroken: () => void; onSwipe?: (direction: -1 | 1) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [turns, setTurns] = useState(0); // quarter turns clockwise
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  // The zoom and offset as last set, so several events in one frame build on each other rather than on a stale render.
  const current = useRef(1);
  const offsetNow = useRef({ x: 0, y: 0 });
  // Fingers on the image, for pinching, and where a one-finger touch began, for swiping.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const multi = useRef(false);

  const moveTo = useCallback((o: { x: number; y: number }) => {
    offsetNow.current = o;
    setOffset(o);
  }, []);
  const zoomTo = useCallback((next: number) => {
    const prev = current.current;
    const z = Math.min(IMAGE_MAX_ZOOM, Math.max(1, next));
    current.current = z;
    setZoom(z);
    const o = offsetNow.current;
    moveTo(z === 1 ? { x: 0, y: 0 } : { x: (o.x * z) / prev, y: (o.y * z) / prev });
  }, [moveTo]);
  const zoomBy = useCallback((factor: number) => zoomTo(current.current * factor), [zoomTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") zoomBy(1.5);
      else if (e.key === "-") zoomBy(1 / 1.5);
      else if (e.key === "0") zoomTo(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, zoomTo]);

  // The wheel listener is not passive, so zooming does not also scroll the page behind the dialog.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1 && current.current > 1) {
      // One finger lifted from a pinch: carry on panning with the other without a jump.
      const [rest] = [...pointers.current.values()];
      drag.current = { x: rest.x, y: rest.y, ox: offsetNow.current.x, oy: offsetNow.current.y };
    } else drag.current = null;
    const start = swipe.current;
    swipe.current = null;
    if (e.type === "pointerup" && wasSingle && !multi.current && start && current.current === 1) {
      const direction = swipeOf(e.clientX - start.x, e.clientY - start.y);
      if (direction) onSwipe?.(direction);
    }
    if (pointers.current.size === 0) multi.current = false;
  };

  // Turned on its side, the picture's frame swaps its shape, and the picture is laid out in the swapped box so it fills it once turned.
  const sideways = turns % 2 === 1;
  const shownRatio = ratio ? (sideways ? 1 / ratio : ratio) : null;
  const motion = { transform: `translate(${offset.x}px, ${offset.y}px) ${sideways ? "translate(-50%, -50%) " : ""}rotate(${turns * 90}deg) scale(${zoom})`, transition: drag.current || pinch.current ? "none" : "transform 80ms" };
  const sidewaysBox = sideways && ratio ? { position: "absolute" as const, top: "50%", left: "50%", width: `${ratio * 100}%`, height: `${100 / ratio}%`, maxWidth: "none" } : null;
  return (
    <div className="flex flex-col gap-3">
      <div
        ref={frame}
        className={cn("relative mx-auto flex max-w-full touch-none items-center justify-center overflow-hidden rounded-lg select-none", !shownRatio && STAGE_HEIGHT, zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
        // Hugs the picture: as wide as fits, up to the stage height's worth, and no wider than the dialog. Only the width is set, so
        // when the dialog is narrower the height follows the picture's shape and no bars appear above and below it.
        style={shownRatio ? { aspectRatio: shownRatio, width: `min(${STAGE_WIDTH}, calc(${STAGE} * ${shownRatio}))` } : { width: "100%" }}
        onDoubleClick={() => zoomTo(current.current > 1 ? 1 : 2.5)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [p, q] = [...pointers.current.values()];
            pinch.current = { dist: Math.hypot(p.x - q.x, p.y - q.y) || 1, zoom: current.current };
            drag.current = null;
            swipe.current = null;
            multi.current = true;
          } else if (pointers.current.size === 1) {
            multi.current = false;
            swipe.current = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null;
            if (current.current > 1) drag.current = { x: e.clientX, y: e.clientY, ox: offsetNow.current.x, oy: offsetNow.current.y };
          }
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const pinching = pinch.current;
          if (pinching && pointers.current.size >= 2) {
            const [p, q] = [...pointers.current.values()];
            zoomTo(pinching.zoom * (Math.hypot(p.x - q.x, p.y - q.y) / pinching.dist));
            return;
          }
          const d = drag.current;
          if (d) moveTo({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {/* The small copy, already in the browser from the tile, fills the frame until the full picture has loaded over it. */}
        {preview && !loaded && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" draggable={false} onLoad={(e) => { const r = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight; setRatio((x) => x ?? r); onRatio?.(r); }} className="absolute inset-0 size-full object-contain" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          draggable={false}
          decoding="async"
          fetchPriority="high"
          onLoad={(e) => { const r = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight; setLoaded(true); setRatio(r); onRatio?.(r); }}
          onError={onBroken}
          className={cn(!sidewaysBox && "size-full", "object-contain", !loaded && preview && "opacity-0")}
          style={{ ...sidewaysBox, ...motion }}
        />
      </div>
      {/* Fit on the left, zoom in the middle and Rotate on the right. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Button variant="ghost" size="icon" className="justify-self-start" aria-label="Fit" title="Fit" disabled={zoom === 1} onClick={() => zoomTo(1)}><Maximize /></Button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Zoom Out" title="Zoom Out" disabled={zoom <= 1} onClick={() => zoomBy(1 / 1.5)}><ZoomOut /></Button>
          <span className="w-11 text-center text-xs text-muted-foreground tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" aria-label="Zoom In" title="Zoom In" disabled={zoom >= IMAGE_MAX_ZOOM} onClick={() => zoomBy(1.5)}><ZoomIn /></Button>
        </div>
        <Button variant="ghost" size="icon" className="justify-self-end" aria-label="Rotate" title="Rotate" onClick={() => { setTurns((t) => (t + 1) % 4); zoomTo(1); }}><RotateCw /></Button>
      </div>
    </div>
  );
}
