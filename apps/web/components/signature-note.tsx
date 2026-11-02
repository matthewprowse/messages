"use client";

// The small note under the text of an email: the signature that will follow it when sent, with a No Signature toggle for this
// one message, and a warning while a template {variable} is still unfilled. Shared by the reply box and New Email.

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function SignatureNote({ signature, off, hasText, onToggle, left, disabled }: { signature: string; off: boolean; hasText: boolean; onToggle: () => void; left: string[]; disabled?: boolean }) {
  if (!signature && left.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
      {left.length > 0 && <p className="text-destructive">Fill in {left.slice(0, 3).join(", ")} before you send.</p>}
      {signature && hasText && (
        <div className="flex items-start gap-2">
          <p className={cn("min-w-0 flex-1 line-clamp-3 whitespace-pre-line", off && "line-through")}>{signature}</p>
          <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={onToggle}>{off ? "Add Signature" : "No Signature"}</Button>
        </div>
      )}
    </div>
  );
}
