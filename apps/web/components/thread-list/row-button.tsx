"use client";

// The small icon button with a tooltip that rows and the selection bar use for their actions.

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function RowButton({ label, icon: Icon, onClick, variant = "ghost", className }: { label: string; icon: LucideIcon; onClick: () => void; variant?: "ghost" | "secondary"; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size="icon" aria-label={label} onClick={onClick} className={className}><Icon /></Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
