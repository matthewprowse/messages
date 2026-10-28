"use client";

// The Storage Flags section of the Analytics page: accounts that look like file hosting, from the storage_flags database function.
// Sizes only; it never blocks anyone.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { bytesLabel } from "@/lib/storage";
import { Note, Section, Table, type Col } from "./parts";

type Flag = { user_id: string; total_bytes: number; week_bytes: number; top_chat_bytes: number; reason: string };

/** Accounts that look like file hosting: sizes only, no names or content. A flag is for looking at, never blocks anything. */
export function StorageFlags() {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("storage_flags").then(({ data, error }) => { if (!cancelled) setFlags(error ? [] : (data ?? [])); });
    return () => { cancelled = true; };
  }, []);
  const cols: Col<Flag>[] = [
    { head: "Account", cell: (f) => <span className="font-mono text-xs">{f.user_id.slice(0, 8)}</span> },
    { head: "Why", cell: (f) => f.reason },
    { head: "Stored", cell: (f) => bytesLabel(f.total_bytes), num: true },
    { head: "Past 7 Days", cell: (f) => bytesLabel(f.week_bytes), num: true, wide: true },
    { head: "Biggest Chat", cell: (f) => bytesLabel(f.top_chat_bytes), num: true, wide: true },
  ];
  return (
    <Section title="Storage Flags" description="Over 5 GB added in a week, or at least 2 GB with over half of it in one one-to-one chat.">
      {flags === null ? <Note>Loading.</Note> : <Table cols={cols} rows={flags} empty="No accounts flagged." />}
    </Section>
  );
}
