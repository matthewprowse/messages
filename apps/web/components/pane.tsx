"use client";

import type { KeyboardEventHandler, ReactNode, Ref } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The pieces every list page is built from, copied from the Inbox so the pages stay the same: a header block
// (a title row with at most one action, then one row of controls), then the search in a band of its own.

/** The title row, with the page's one action on the right, and the controls row under it. */
export function PaneHeader({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-3 border-b p-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex h-8 min-w-0 items-center truncate text-lg font-medium">{title}</h1>
        {action}
      </div>
      {children}
    </div>
  );
}

/** One row of controls: views on the left, a filter or sort on the right. */
export function PaneControls({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3">{children}</div>;
}

/** The views of a page as text buttons: the open one filled, the rest quiet. They scroll sideways when the column is narrow. */
export function ViewButtons<T extends string>({ items, value, onSelect, label }: { items: { key: T; label: string }[]; value: T; onSelect: (key: T) => void; label: string }) {
  return (
    <nav aria-label={label} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((v) => (
        <Button
          key={v.key}
          type="button"
          variant={value === v.key ? "secondary" : "ghost"}
          aria-current={value === v.key ? "page" : undefined}
          className={cn("shrink-0 px-2", value !== v.key && "text-muted-foreground")}
          onClick={() => onSelect(v.key)}
        >
          {v.label}
        </Button>
      ))}
    </nav>
  );
}

/** A filter or sort: the same small select everywhere. */
export function PaneSelect({ value, onChange, options, label, placeholder, className }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label: string; placeholder?: string; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn("w-36 data-[size=default]:h-8", className)}>
        <SelectValue placeholder={placeholder ?? label} />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** The search, in a band of its own under the header, with the magnifier. */
export function SearchBand({ value, onChange, placeholder, inputRef, onKeyDown, maxLength, className, hint, keyShortcut }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  maxLength?: number;
  className?: string;
  /** What a hover says, such as the shortcut that jumps here. */
  hint?: ReactNode;
  keyShortcut?: string;
}) {
  const input = (
    <Input
          ref={inputRef}
          type="search"
          className="pl-8"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown ?? ((e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } })}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-keyshortcuts={keyShortcut}
          maxLength={maxLength}
          autoComplete="off"
        />
  );
  return (
    <div className={cn("border-b p-3", className)}>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        {hint ? (
          <Tooltip>
            <TooltipTrigger asChild>{input}</TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        ) : input}
      </div>
    </div>
  );
}
