"use client";

// The home page's Industries section: the trades in a list on the left, and on the right that trade's pitch with its
// own inbox. It moves to the next trade on its own every few seconds (the bar under the chosen one shows when), pauses
// while the pointer is over it, and stops for good once someone picks a trade themselves.

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DemoFrame, DemoPriority } from "./demo-app";
import { SECTORS } from "./sectors";

const DWELL = 7000; // ms on each trade

export function IndustryShowcase() {
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [picked, setPicked] = useState(false);
  const auto = !picked && !hovering;

  useEffect(() => {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % SECTORS.length), DWELL);
    return () => window.clearTimeout(id);
  }, [auto, index]);

  const s = SECTORS[index];
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]" onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}>
      <div role="tablist" aria-label="Industries" className="flex gap-2 overflow-x-auto rounded-2xl border bg-muted/30 p-2 lg:flex-col lg:overflow-visible">
        {SECTORS.map((sector, i) => {
          const active = i === index;
          return (
            <button
              key={sector.key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="industry-panel"
              onClick={() => { setIndex(i); setPicked(true); }}
              className={cn("relative flex shrink-0 flex-col gap-1 overflow-hidden rounded-xl px-4 py-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50", active ? "bg-background shadow-xs" : "hover:bg-background/60")}
            >
              <span className={cn("text-sm font-medium", !active && "text-muted-foreground")}>{sector.name}</span>
              <span className="hidden text-xs text-muted-foreground lg:block">{sector.short}</span>
              {active && !picked && <span key={index} data-paused={hovering} style={{ "--duration": `${DWELL}ms` } as React.CSSProperties} className="industry-progress absolute inset-x-0 bottom-0 h-0.5 bg-foreground/20" />}
            </button>
          );
        })}
      </div>
      <div id="industry-panel" role="tabpanel" className="overflow-hidden rounded-2xl border bg-muted/30 p-3">
        <div key={s.key} className="grid h-full gap-6 animate-in fade-in-0 duration-500 xl:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col justify-center gap-4 p-3 md:p-5">
            <h3 className="text-2xl font-semibold tracking-tight text-balance">{s.title}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{s.text}</p>
            <ul className="mt-2 flex flex-col gap-2.5 text-sm">
              {s.points.map((p) => <li key={p} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0" aria-hidden />{p}</li>)}
            </ul>
          </div>
          <DemoFrame label={`Conversations for ${s.name.toLowerCase()}, marked by priority with a one line summary each`} className="h-[340px]">
            <DemoPriority demo={s.key} limit={3} />
          </DemoFrame>
        </div>
      </div>
    </div>
  );
}
