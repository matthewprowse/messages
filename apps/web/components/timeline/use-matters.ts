"use client";

// A contact's matters and what they hold, with the changes a person makes: new, rename, close, put an item in, take it out.
// Each change shows at once and is put back with a toast when saving fails.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { addToMatter, createMatter, deleteMatter, loadMatters, removeFromMatter, renameMatter, setMatterClosed } from "@/lib/timeline/matters-io";
import type { Matter, MatterKind, MatterLink } from "@/lib/timeline/matters";
import type { RefKind } from "@/lib/timeline/types";

export function useMatters(contactId: string) {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [links, setLinks] = useState<MatterLink[]>([]);

  useEffect(() => {
    let live = true;
    // Optional: with the table missing the timeline works without matters.
    loadMatters(contactId).then((r) => { if (live) { setMatters(r.matters); setLinks(r.links); } }, () => {});
    return () => { live = false; };
  }, [contactId]);

  /** Makes a matter; resolves to it, or null after a toast when it could not be saved. */
  const create = useCallback(async (name: string, kind: MatterKind) => {
    try {
      const m = await createMatter(contactId, name, kind);
      setMatters((all) => [...all, m]);
      track("feature_used", { feature: "matter_created", detail: kind });
      return m;
    } catch {
      toast.error("Could not save that matter. Please try again.");
      return null;
    }
  }, [contactId]);

  const edit = useCallback((id: string, name: string, kind: MatterKind) => {
    const before = matters;
    setMatters((all) => all.map((m) => (m.id === id ? { ...m, name, kind } : m)));
    renameMatter(id, name, kind).catch(() => { setMatters(before); toast.error("Could not rename that matter."); });
  }, [matters]);

  const close = useCallback((id: string, closed: boolean) => {
    const before = matters;
    setMatters((all) => all.map((m) => (m.id === id ? { ...m, closed, closedAt: closed ? new Date().toISOString() : null } : m)));
    setMatterClosed(id, closed).catch(() => { setMatters(before); toast.error("Could not save that. Please try again."); });
  }, [matters]);

  const remove = useCallback((id: string) => {
    const beforeMatters = matters, beforeLinks = links;
    setMatters((all) => all.filter((m) => m.id !== id));
    setLinks((all) => all.filter((l) => l.matterId !== id));
    deleteMatter(id).catch(() => { setMatters(beforeMatters); setLinks(beforeLinks); toast.error("Could not delete that matter."); });
  }, [matters, links]);

  const add = useCallback(async (matterId: string, kind: RefKind, targetId: string) => {
    try {
      const link = await addToMatter(matterId, kind, targetId);
      if (link) setLinks((all) => [...all, link]);
      track("feature_used", { feature: "matter_linked", detail: kind });
    } catch {
      toast.error("Could not add that to the matter.");
    }
  }, []);

  const take = useCallback((matterId: string, kind: RefKind, targetId: string) => {
    const before = links;
    setLinks((all) => all.filter((l) => !(l.matterId === matterId && l.kind === kind && l.targetId === targetId)));
    removeFromMatter(matterId, kind, targetId).catch(() => { setLinks(before); toast.error("Could not take that out of the matter."); });
  }, [links]);

  return { matters, links, create, edit, close, remove, add, take };
}
