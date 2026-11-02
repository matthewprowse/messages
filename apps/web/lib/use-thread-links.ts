"use client";

// Same-matter links for some conversations (public.thread_links): loads the rows that touch them, keeps them live through
// Realtime, and answers a suggestion. A row holds ids only, so nothing here is sealed. Answers show at once and are put back
// with a toast when the save fails.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "./supabase";
import { mapLink, type LinkStatus, type ThreadLink } from "./thread-links";

const COLUMNS = "id, thread_a, thread_b, contact_id, status, score, source";

export function useThreadLinks(threadIds: string[]) {
  const [links, setLinks] = useState<ThreadLink[]>([]);
  // A new array each render must not reload; the ids themselves decide.
  const key = useMemo(() => [...threadIds].sort().join(","), [threadIds]);

  const load = useCallback(async () => {
    if (!key) { setLinks([]); return; }
    const list = `(${key})`;
    const { data, error } = await supabase.from("thread_links").select(COLUMNS).or(`thread_a.in.${list},thread_b.in.${list}`);
    if (!error) setLinks((data ?? []).map(mapLink));
  }, [key]);

  useEffect(() => {
    void load();
    if (!key) return;
    // The AI worker adds suggestions while the page is open.
    const channel = supabase.channel(`thread-links:${key.slice(0, 40)}`).on("postgres_changes", { event: "*", schema: "public", table: "thread_links" }, () => { void load(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, key]);

  /** Links two suggested conversations (status "linked"), or says they are not the same matter ("dismissed"). Linked ones can be unlinked the same way. */
  const decide = useCallback(async (link: ThreadLink, status: LinkStatus) => {
    const before = links;
    setLinks((all) => all.map((l) => (l.id === link.id ? { ...l, status } : l)));
    const { error } = await supabase.from("thread_links").update({ status, decided_at: new Date().toISOString() }).eq("id", link.id);
    if (error) {
      setLinks(before);
      toast("Could not save that. Please try again.");
    }
  }, [links]);

  return { links, decide };
}
