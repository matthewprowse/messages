// Merging, splitting and reloading contacts. After each change the contact list and the open conversations that
// involve the affected people are loaded again.

import { useCallback } from "react";
import { toast } from "sonner";
import { keepName, loadContactGraph, mergeContactsRpc, mergeErrorText, splitContactRpc, undoMergeRpc } from "../contact-merging";
import { loadThreadMessages } from "../data";
import { track } from "../analytics";
import type { Contact } from "../types";
import type { Action, State } from "./reducer";

export interface ContactMergingDeps {
  rawDispatch: React.Dispatch<Action>;
  stateRef: React.MutableRefObject<State>;
  loadedRef: React.MutableRefObject<Set<string>>;
  notify: (text: string, undo?: () => void) => void;
  setContactsReady: React.Dispatch<React.SetStateAction<boolean>>;
  setContactsVersion: React.Dispatch<React.SetStateAction<number>>;
  setMergedInto: React.Dispatch<React.SetStateAction<Record<string, string | undefined>>>;
}

/** The contact actions of the context. */
export function useContactMerging({ rawDispatch, stateRef, loadedRef, notify, setContactsReady, setContactsVersion, setMergedInto }: ContactMergingDeps) {
  // After a merge, split or undo: every contact and conversation member again, and the open
  // conversations whose senders or members changed.
  const refreshContacts = useCallback(async (affected: string[]) => {
    // The change is already saved, so the Contacts lists reload straight away, from the database until the store has caught up.
    setContactsReady(false);
    setContactsVersion((v) => v + 1);
    let contacts: Contact[] = stateRef.current.contacts;
    try {
      const graph = await loadContactGraph();
      contacts = graph.contacts;
      const ids = new Set(affected);
      const threadIds = new Set<string>();
      for (const [threadId, list] of Object.entries(stateRef.current.byThread)) if (loadedRef.current.has(threadId) && list.some((m) => ids.has(m.from))) threadIds.add(threadId);
      for (const [threadId, members] of graph.participants) if (loadedRef.current.has(threadId) && members.some((id) => ids.has(id))) threadIds.add(threadId);
      rawDispatch({ type: "setContactGraph", contacts: graph.contacts, participants: graph.participants });
      setContactsReady(true);
      // Everything already loaded is fetched again for its new senders, keeping older pages and jumps.
      await Promise.all([...threadIds].map(async (threadId) => {
        const oldest = stateRef.current.byThread[threadId]?.[0];
        if (!oldest) return;
        const page = await loadThreadMessages(threadId, { from: oldest.sentAt });
        rawDispatch({ type: "mergeMessages", threadId, messages: page.messages });
      }));
    } catch {
      toast("Could not refresh your contacts. Reload to see the change.");
    }
    return contacts;
  }, []);

  const undoMerge = useCallback(async (mergeId: string) => {
    const { error, keptId, mergedId } = await undoMergeRpc(mergeId);
    if (error) {
      toast(mergeErrorText(error, "Could not undo the merge. Check your connection and try again."));
      return false;
    }
    if (mergedId) setMergedInto((m) => ({ ...m, [mergedId]: undefined }));
    await refreshContacts([keptId, mergedId].filter((id): id is string => !!id));
    toast("Merge undone");
    return true;
  }, [refreshContacts]);

  const mergeContacts = useCallback(async (keepId: string, mergeId: string, reason: "suggestion" | "manual", name?: string) => {
    const { data, error } = await mergeContactsRpc(keepId, mergeId, reason);
    if (error || !data) {
      toast(mergeErrorText(error, "Could not merge these contacts. Check your connection and try again."));
      return null;
    }
    track("feature_used", { feature: "merge_contacts", detail: reason });
    if (name) await keepName(keepId, name).catch(() => { toast("Merged, but could not keep the name you chose."); });
    setMergedInto((m) => ({ ...m, [mergeId]: keepId }));
    const contacts = await refreshContacts([keepId, mergeId]);
    const kept = contacts.find((c) => c.id === keepId)?.name ?? name;
    notify(kept ? `Merged into ${kept}` : "Merged", () => { void undoMerge(data); });
    return data;
  }, [refreshContacts, notify, undoMerge]);

  const splitContact = useCallback(async (contactId: string, identityIds: string[], name: string) => {
    const { data, error } = await splitContactRpc(contactId, identityIds, name);
    if (error || !data) {
      toast(mergeErrorText(error, "Could not split this contact. Check your connection and try again."));
      return null;
    }
    track("feature_used", { feature: "split_contact" });
    await refreshContacts([contactId, data]);
    return data;
  }, [refreshContacts]);

  return { refreshContacts, undoMerge, mergeContacts, splitContact };
}
