"use client";

// A tooltip around one control, for the icon buttons that only say what they do on hover. Wraps a trigger too
// (a DropdownMenuTrigger asChild around its Button), since Radix triggers pass the hover through. IconAction is the ghost
// icon button with its tooltip that headers and rows use.

import type { ComponentProps, ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A ghost h-8 icon button with its name as a tooltip: the header and row actions everywhere. */
export function IconAction({ label, icon: Icon, onClick, active = false, disabled, ...rest }: { label: string; icon: LucideIcon; onClick?: () => void; active?: boolean; disabled?: boolean } & Omit<ComponentProps<typeof Button>, "children" | "onClick">) {
  return (
    <Tip label={label}>
      <Button type="button" variant={active ? "secondary" : "ghost"} size="icon" aria-label={label} aria-pressed={active || undefined} disabled={disabled} onClick={onClick} {...rest}>
        <Icon />
      </Button>
    </Tip>
  );
}
