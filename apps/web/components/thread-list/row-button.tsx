"use client";

// The small icon button with a tooltip that rows and the selection bar use for their actions.

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** `keys` is the shortcut the Inbox answers to ("e"), announced to screen readers. Delete is plain like the rest: no red. */
export function RowButton({ label, icon: Icon, onClick, variant = "ghost", className, keys }: { label: string; icon: LucideIcon; onClick: () => void; variant?: "ghost" | "secondary"; className?: string; keys?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size="icon" aria-label={label} aria-keyshortcuts={keys} onClick={onClick} className={className}><Icon /></Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
