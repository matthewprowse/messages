// The Konva K, drawn in the text colour so it follows light and dark. The same shape is public/icon.svg and the app icons.

import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 191 120" fill="currentColor" aria-hidden className={cn("h-auto", className)}>
      <path d="M38.5 0H90L0 120V51.3ZM140 0H191L152.5 51.5H101.5ZM51.5 51.5H102.5L153 120H102Z" />
    </svg>
  );
}
