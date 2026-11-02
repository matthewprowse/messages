"use client";

// The small icon button with a tooltip that rows and the selection bar use for their actions.

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** `keys` is the shortcut the Inbox answers to ("e"), announced to screen readers; `destructive` turns the icon red on hover. */
export function RowButton({ label, icon: Icon, onClick, variant = "ghost", className, keys, destructive }: { label: string; icon: LucideIcon; onClick: () => void; variant?: "ghost" | "secondary"; className?: string; keys?: string; destructive?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size="icon" aria-label={label} aria-keyshortcuts={keys} onClick={onClick} className={cn(destructive && "hover:text-destructive", className)}><Icon /></Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
