"use client";

// Checked conversations in the Inbox and Summary lists: toggling, shift-click ranges, and actions that return to the list.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toggleSelection } from "@/lib/selection";
import { leaveHref, sideBySide } from "@/lib/thread-nav";
import { useRowActions, type RowAction } from "./use-row-actions";

/**
 * Checked rows, shift-click ranges and bulk actions. `order` is the rows top to bottom, the selection clears
 * whenever `reset` changes, and basePath is where it returns when the open conversation goes.
 * A Snooze with no time (the button, the bulk bar) goes to `ask` instead, which opens the choices or, on the Summary,
 * snoozes to tomorrow morning by calling `run` itself.
 */
export function useThreadSelection(order: string[], query: string, reset: string, basePath = "/inbox", advance = false, ask?: (ids: string[], run: (ids: string[], action: RowAction, at?: Date) => void) => void) {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const act = useRowActions();

  // Checked conversations. Ones that leave the list (archived, deleted) drop out of the selection.
  const [checked, setChecked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const picked = useMemo(() => {
    const inList = new Set(order);
    return checked.filter((id) => inList.has(id));
  }, [checked, order]);
  useEffect(() => { setChecked([]); }, [reset]);

  // Acting on the open conversation moves it out of the list: the next conversation opens (with `advance`, side by
  // side) or the list shows. It replaces the address, so Back does not return to a conversation that is gone.
  const orderRef = useRef(order);
  orderRef.current = order;
  const askRef = useRef(ask);
  askRef.current = ask;
  const runRef = useRef<(ids: string[], action: RowAction, at?: Date) => void>(() => undefined);
  const run = useCallback((ids: string[], action: RowAction, at?: Date): void => {
    if (action === "snooze" && !at && askRef.current) return askRef.current(ids, (i, a, t) => runRef.current(i, a, t));
    act(ids, action, at);
    if (action === "read" || action === "pin") return;
    const gone = new Set(ids);
    setChecked((c) => c.filter((id) => !gone.has(id)));
    if (params.id && gone.has(params.id)) router.replace(leaveHref(orderRef.current, gone, params.id, basePath, query, sideBySide(), advance));
  }, [act, params.id, router, query, basePath, advance]);
  runRef.current = run;

  // Row callbacks and the key handler read the latest list through this ref, so they never change.
  const latest = useRef({ order, picked, run });
  latest.current = { order, picked, run };

  const check = useCallback((id: string, range: boolean) => {
    const from = anchor.current; // read now: the update below runs later, after the anchor has moved
    setChecked((c) => toggleSelection(latest.current.order, c, id, from, range));
    anchor.current = id;
  }, []);

  // Acts on the row, or on the whole selection when the row is part of it.
  const onRowAction = useCallback((id: string, action: RowAction) => {
    const { picked, run } = latest.current;
    run(picked.includes(id) ? picked : [id], action);
  }, []);

  return { picked, setChecked, check, run, onRowAction };
}
