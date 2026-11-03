"use client";

// A tooltip around one control, for the icon buttons that only say what they do on hover. Wraps a trigger too
// (a DropdownMenuTrigger asChild around its Button), since Radix triggers pass the hover through.

import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
