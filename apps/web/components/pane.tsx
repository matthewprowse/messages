"use client";

// The pieces every list page is built from, copied from the Inbox so the pages stay the same: a header block
// (a title row with at most one action, then one row of controls), then the search in a band of its own.

import { useCallback, useEffect, useRef, useState, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The 40px title row, with the page's actions (h-8 buttons) on the right, and the controls row under it. */
export function PaneHeader({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-3 border-b p-3", className)}>
      <div className="flex h-10 items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-xl font-medium">{title}</h1>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </div>
      {children}
    </div>
  );
}

/** One row of controls: views on the left, a filter or sort on the right. */
export function PaneControls({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3">{children}</div>;
}

/** True while a sideways scroller has more content past its right edge. */
export function useMoreToRight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [more, setMore] = useState(false);
  const update = useCallback(() => {
    const el = ref.current;
    if (el) setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);
  return { ref, more, onScroll: update };
}

/** A quiet unread count (count) or a dot (dot: something new) after a view's label. Read aloud as part of the link. */
function ViewMark({ count, dot }: { count?: number; dot?: boolean }) {
  if (count) return <span className="text-xs tabular-nums text-muted-foreground">{count > 99 ? "99+" : count}</span>;
  return dot ? <span role="img" aria-label="New" className="size-1.5 rounded-full bg-primary" /> : null;
}

/**
 * The views of a page as text buttons: the open one filled, the rest quiet. They scroll sideways when the column is narrow,
 * fading out beside the filter until the end. With `hrefFor` each is a link (the Inbox's views live in the address).
 */
export function ViewButtons<T extends string>({ items, value, onSelect, hrefFor, label }: { items: { key: T; label: string; count?: number; dot?: boolean }[]; value: T; onSelect?: (key: T) => void; hrefFor?: (key: T) => string; label: string }) {
  const scroller = useMoreToRight<HTMLElement>();
  return (
    <div className="relative min-w-0 flex-1">
      <nav ref={scroller.ref} onScroll={scroller.onScroll} aria-label={label} className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((v) => {
          const active = value === v.key;
          const className = cn("shrink-0 px-2", !active && "text-muted-foreground");
          return hrefFor ? (
            <Button key={v.key} asChild variant={active ? "secondary" : "ghost"} className={className}>
              <Link href={hrefFor(v.key)} replace aria-current={active ? "page" : undefined}>{v.label}<ViewMark count={v.count} dot={v.dot} /></Link>
            </Button>
          ) : (
            <Button key={v.key} type="button" variant={active ? "secondary" : "ghost"} aria-current={active ? "page" : undefined} className={className} onClick={() => onSelect?.(v.key)}>
              {v.label}<ViewMark count={v.count} dot={v.dot} />
            </Button>
          );
        })}
      </nav>
      {scroller.more && <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-r from-transparent to-background" />}
    </div>
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
export function SearchBand({ value, onChange, placeholder, inputRef, onKeyDown, maxLength, className, inputClassName, hint, keyShortcut }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  maxLength?: number;
  className?: string;
  inputClassName?: string;
  /** What a hover says, such as the shortcut that jumps here. */
  hint?: ReactNode;
  keyShortcut?: string;
}) {
  const input = (
    <Input
          ref={inputRef}
          type="search"
          className={cn("pl-8", inputClassName)}
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
