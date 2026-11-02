"use client";

// Checked conversations in the Inbox and Summary lists: toggling, shift-click ranges, and actions that return to the list.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toggleSelection } from "@/lib/selection";
import { withQuery } from "@/lib/thread-list";
import { useRowActions, type RowAction } from "./use-row-actions";

/**
 * Checked rows, shift-click ranges and bulk actions. `order` is the rows top to bottom, the selection clears
 * whenever `reset` changes, and basePath is where it returns when the open conversation goes.
 */
export function useThreadSelection(order: string[], query: string, reset: string, basePath = "/inbox") {
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

  // Acting on the open conversation, or one it moves out of the list, goes back to the list.
  const run = useCallback((ids: string[], action: RowAction) => {
    act(ids, action);
    if (action === "read" || action === "pin") return;
    const gone = new Set(ids);
    setChecked((c) => c.filter((id) => !gone.has(id)));
    if (params.id && gone.has(params.id)) router.push(withQuery(basePath, query));
  }, [act, params.id, router, query, basePath]);

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
