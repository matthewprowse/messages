"use client";

// One series over time as bars, in a card of its own: the title row reads out the day under the pointer. The bars use the
// Conversations heatmap's foreground shades, so the two charts in the app look like one family.

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/surface";
import { num } from "./format";
import { Quiet } from "./parts";

/**
 * The bars are one stop for the keyboard: the arrow keys move between days, Home and End go to the first and last, and a
 * tap picks a day. The numbers are also in a table for screen readers.
 */
export function Bars({ data, format = num, label }: { data: { label: string; value: number }[]; format?: (n: number) => string; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const last = data.length - 1;
  const max = Math.max(1, ...data.map((d) => d.value));

  if (data.length === 0 || data.every((d) => d.value === 0)) return <Card title={label}><Quiet>Nothing Recorded In This Period</Quiet></Card>;

  const shown = active === null ? null : data[active];
  const pick = (e: PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setActive(Math.max(0, Math.min(last, Math.floor(((e.clientX - r.left) / r.width) * data.length))));
  };
  const key = (e: KeyboardEvent) => {
    const to = e.key === "ArrowRight" ? Math.min(last, (active ?? -1) + 1) : e.key === "ArrowLeft" ? Math.max(0, (active ?? data.length) - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "Escape" ? null : undefined;
    if (to === undefined) return;
    e.preventDefault();
    setActive(to);
  };

  return (
    <Card title={label} action={<span className="shrink-0 text-sm tabular-nums" aria-live="polite">{shown ? `${shown.label}: ${format(shown.value)}` : ""}</span>}>
      <div className="px-3 pb-3">
        <div
          ref={box}
          role="group"
          aria-roledescription="chart"
          aria-label={`${label}, ${data.length} days. Use the left and right arrow keys to move between days.`}
          tabIndex={0}
          className="flex h-28 touch-pan-y items-end gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onPointerDown={pick}
          onPointerMove={(e) => (e.pointerType === "mouse" || e.buttons > 0) && pick(e)}
          onPointerLeave={(e) => e.pointerType === "mouse" && document.activeElement !== box.current && setActive(null)}
          onFocus={() => setActive((a) => a ?? last)}
          onBlur={() => setActive(null)}
          onKeyDown={key}
        >
          {data.map((d, i) => (
            <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-0.5" aria-hidden>
              {/* A day with nothing keeps a muted stub, as an empty heatmap day does, so the run of days stays readable. */}
              <div
                className={cn("w-full rounded-sm", d.value === 0 ? "bg-muted" : active === null ? "bg-foreground/65" : active === i ? "bg-foreground" : "bg-foreground/20")}
                style={{ height: d.value === 0 ? 3 : `${Math.max(3, (d.value / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{data[0]?.label}</span>
          <span>{data.at(-1)?.label}</span>
        </div>
      </div>
      {/* The hiding sits on a wrapper: browsers ignore sr-only's clip on a table, so its caption painted over the page. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{format(d.value)}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}
