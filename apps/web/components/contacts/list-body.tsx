"use client";

// The body of the Contacts list: loading rows, a reason it is empty, or the rows drawn a page at a time.

import { Children, isValidElement, useEffect, useRef, useState } from "react";
import type { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/primitives";
import { Divided } from "./list-rows";

function LoadingRows({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Rows drawn at first, and added each time the end of the list scrolls into view.
const PAGE_ROWS = 100;

/** Loading rows, a reason it is empty, or the rows with separators between them, drawn a page at a time. */
export function ListBody({ items, label, icon, failed, empty, onRetry, children }: {
  items: unknown[] | null | undefined;
  label: string;
  icon: typeof Users;
  failed: string;
  empty: { title: string; description: string; action?: React.ReactNode };
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const rows = Children.toArray(children);
  const [shown, setShown] = useState(PAGE_ROWS);
  const end = useRef<HTMLDivElement>(null);
  // The open row is always drawn, however far down it is.
  const open = rows.findIndex((r) => isValidElement<{ selected?: boolean }>(r) && r.props.selected);
  const count = Math.min(rows.length, Math.max(shown, open + 1));
  const more = count < rows.length;

  useEffect(() => {
    const node = end.current;
    if (!more || !node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown(count + PAGE_ROWS);
    }, { rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, count]);

  if (items === undefined) return <LoadingRows label={label} />;
  if (rows.length === 0) {
    return (
      <div className="py-24">
        {items === null ? (
          <EmptyState icon={icon} title={failed} description="Check your connection, then try again." action={<Button variant="secondary" onClick={onRetry}>Retry</Button>} />
        ) : (
          <EmptyState icon={icon} title={empty.title} description={empty.description} action={empty.action || undefined} />
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Divided className="pl-14">{rows.slice(0, count)}</Divided>
      {more && <div ref={end} className="h-px" aria-hidden />}
    </div>
  );
}
