"use client";

// Admin's System view, Storage Flags: accounts that look like file hosting (over 5 GB added in a week, or at least 2 GB with
// over half in one one to one chat), from the storage_flags database function. Sizes only; a flag never blocks anyone.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { bytesLabel } from "@/lib/storage";
import { Card } from "@/components/surface";
import { LoadingCard } from "@/components/admin/parts";
import { Table, type Col } from "@/components/admin/table";

type Flag = { user_id: string; total_bytes: number; week_bytes: number; top_chat_bytes: number; reason: string };

const COLS: Col<Flag>[] = [
  { head: "Account", cell: (f) => <span className="font-mono text-xs">{f.user_id.slice(0, 8)}</span> },
  { head: "Why", cell: (f) => f.reason },
  { head: "Stored", cell: (f) => bytesLabel(f.total_bytes), num: true },
  { head: "Past 7 Days", cell: (f) => bytesLabel(f.week_bytes), num: true, wide: true },
  { head: "Biggest Chat", cell: (f) => bytesLabel(f.top_chat_bytes), num: true, wide: true },
];

/** Reloads when `version` changes (the header Refresh). A failed load reads as nothing flagged, as it always has. */
export function StorageFlags({ version }: { version: number }) {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("storage_flags").then(({ data, error }) => { if (!cancelled) setFlags(error ? [] : (data ?? [])); });
    return () => { cancelled = true; };
  }, [version]);
  if (flags === null) return <LoadingCard title="Storage Flags" rows={1} />;
  return <Card title="Storage Flags"><Table cols={COLS} rows={flags} empty="No Accounts Flagged" /></Card>;
}
