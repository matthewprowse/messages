"use client";

// Hooks that ask the index for results as the text changes: the palette's grouped results and the Inbox list's matching
// conversations. Both re-run when the index fills in, so a search left open during the first build keeps improving.
// The text is only ever passed to the local worker.

import { useEffect, useState } from "react";
import { searchIndex, searchThreadIds } from "./client";
import { useIndexProgress } from "./status";
import type { Kind, SearchResult } from "./types";

/** Results per group in the palette. */
export const PALETTE_LIMITS: Partial<Record<Kind, number>> = { thread: 5, message: 10, contact: 5, note: 4, event: 4, task: 4, file: 5 };

/** Grouped results for the text, or null while the index is not open or there is nothing to search for. */
export function useIndexResults(text: string, limits: Partial<Record<Kind, number>> = PALETTE_LIMITS): SearchResult | null {
  const { ready, rev } = useIndexProgress();
  const [result, setResult] = useState<{ text: string; value: SearchResult | null }>({ text: "", value: null });
  useEffect(() => {
    if (!ready || !text.trim()) return;
    let stale = false;
    void searchIndex(text, limits).then((value) => { if (!stale) setResult({ text, value }); });
    return () => { stale = true; };
  }, [text, ready, rev, limits]);
  // A result for older text is not shown against newer text.
  return ready && result.text === text ? result.value : null;
}

/** The conversations matching the text, as ids. Null while the index cannot answer: the caller then filters what is loaded. */
export function useIndexThreadIds(text: string): Set<string> | null {
  const { ready, rev } = useIndexProgress();
  const [result, setResult] = useState<{ text: string; value: Set<string> | null }>({ text: "", value: null });
  useEffect(() => {
    if (!ready || !text.trim()) return;
    let stale = false;
    void searchThreadIds(text).then((value) => { if (!stale) setResult({ text, value }); });
    return () => { stale = true; };
  }, [text, ready, rev]);
  return ready && result.text === text ? result.value : null;
}
