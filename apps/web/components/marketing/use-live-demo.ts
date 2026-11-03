"use client";

// The hero's little story, played once on load: Konva writes the open chat's reply word by word, then new leads land
// at the top of the list one after another. Anyone who asks for reduced motion sees the finished state straight away.

import { useEffect, useMemo, useState } from "react";
import type { Thread } from "@/lib/types";
import type { DemoSet } from "./demo-data";

const DRAFT_START = 900; // ms after mount
const PER_WORD = 70; // ms
const FIRST_ARRIVAL = 6000; // ms after mount
const BETWEEN_ARRIVALS = 4000; // ms
const NONE: string[] = []; // one array, so a set without arrivals does not restart the effect on every render

/**
 * The list as it stands (arrivals first, newest on top), the ids that just arrived, and how much of the draft is
 * written. Off (`play` false), nothing runs and the result is unused.
 */
export function useLiveDemo(set: DemoSet, now: number, play: boolean) {
  const words = useMemo(() => set.draft.split(" "), [set.draft]);
  const incoming = set.incoming ?? NONE;
  const [wordsShown, setWordsShown] = useState(0);
  const [arrived, setArrived] = useState<{ id: string; at: number }[]>([]);

  useEffect(() => {
    if (!play) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setWordsShown(words.length);
      setArrived(incoming.map((id, i) => ({ id, at: Date.now() - i * 60_000 })));
      return;
    }
    const timers = words.map((_, i) => window.setTimeout(() => setWordsShown(i + 1), DRAFT_START + i * PER_WORD));
    incoming.forEach((id, i) => {
      timers.push(window.setTimeout(() => setArrived((a) => [{ id, at: Date.now() }, ...a]), FIRST_ARRIVAL + i * BETWEEN_ARRIVALS));
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [words, incoming, play]);

  const threads = useMemo(() => {
    const all = set.threads(now);
    const byId = new Map(all.map((t) => [t.id, t]));
    const fresh: Thread[] = arrived.map(({ id, at }) => ({ ...byId.get(id)!, lastMessageAt: new Date(at).toISOString() }));
    const rest = all.filter((t) => !incoming.includes(t.id));
    return [...fresh, ...rest];
  }, [set, now, arrived, incoming]);

  return { threads, freshIds: arrived.map((a) => a.id), draft: words.slice(0, wordsShown).join(" "), drafting: wordsShown < words.length };
}
