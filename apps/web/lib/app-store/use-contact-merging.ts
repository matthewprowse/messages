// Merging, splitting and reloading contacts. A merge patches the contacts the store already holds and tells the
// Contacts page what changed (contactChanges), so nothing is read again; a split or an undo restores people the store
// does not have, so those still reload the contact graph once.

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { keepName, loadContactGraph, mergeContactsRpc, mergeErrorText, splitContactRpc, undoMergeRpc } from "../contact-merging";
import { loadThreadMessages } from "../data";
import { track } from "../analytics";
import type { Contact } from "../types";
import type { ContactChange, ContactPatch } from "./contact-patch";
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
  // Everything that changed a contact since the app opened, oldest first. The Contacts page applies the ones it has not seen.
  const [contactChanges, setContactChanges] = useState<ContactChange[]>([]);
  // Goes up when the whole contact graph was read again, so the Contacts page reads its lists again once.
  const [contactsRefreshed, setContactsRefreshed] = useState(0);
  const announce = useCallback((change: ContactChange) => setContactChanges((list) => [...list, change]), []);

  // After a split, an undo, an edit or a new contact: every contact and conversation member again, and the open
  // conversations whose senders or members changed.
  const refreshContacts = useCallback(async (affected: string[]) => {
    // The change is already saved. The Contacts lists keep what they show and read once, when the store is ready again.
    setContactsReady(false);
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
      setContactsVersion((v) => v + 1);
      setContactsRefreshed((n) => n + 1);
      // Everything already loaded is fetched again for its new senders, keeping older pages and jumps.
      await Promise.all([...threadIds].map(async (threadId) => {
        const oldest = stateRef.current.byThread[threadId]?.[0];
        if (!oldest) return;
        const page = await loadThreadMessages(threadId, { from: oldest.sentAt });
        rawDispatch({ type: "mergeMessages", threadId, messages: page.messages });
      }));
    } catch {
      // The lists read again from what the store holds (or from the database if it is missing someone).
      setContactsReady(true);
      setContactsVersion((v) => v + 1);
      setContactsRefreshed((n) => n + 1);
      toast("Could not refresh your contacts. Reload to see the change.");
    }
    return contacts;
  }, []);

  const undoMerge = useCallback(async (mergeId: string, opts?: { refresh?: boolean }) => {
    const { error, keptId, mergedId } = await undoMergeRpc(mergeId);
    if (error) {
      toast(mergeErrorText(error, "Could not undo the merge. Check your connection and try again."));
      return false;
    }
    if (mergedId) setMergedInto((m) => ({ ...m, [mergedId]: undefined }));
    // Undo brings someone back whom the store no longer holds, so this one still reads the graph (once, for a batch).
    if (opts?.refresh !== false) {
      await refreshContacts([keptId, mergedId].filter((id): id is string => !!id));
      toast("Merge undone");
    }
    return true;
  }, [refreshContacts]);

  // quiet: the caller (Merge All) shows one message for the whole run instead of one per pair.
  const mergeContacts = useCallback(async (keepId: string, mergeId: string, reason: "suggestion" | "manual", name?: string, opts?: { quiet?: boolean }) => {
    const { data, error } = await mergeContactsRpc(keepId, mergeId, reason);
    if (error || !data) {
      toast(mergeErrorText(error, "Could not merge these contacts. Check your connection and try again."));
      return null;
    }
    track("feature_used", { feature: "merge_contacts", detail: reason });
    if (name) await keepName(keepId, name).catch(() => { toast("Merged, but could not keep the name you chose."); });
    const kept = name ?? stateRef.current.contacts.find((c) => c.id === keepId)?.name;
    setMergedInto((m) => ({ ...m, [mergeId]: keepId }));
    // The merge is patched into what the store and the Contacts lists hold; open pages for these people reload on their own.
    rawDispatch({ type: "mergeContactLocal", keepId, mergeId, name });
    announce({ kind: "merge", keepId, mergeId, name });
    setContactsVersion((v) => v + 1);
    if (!opts?.quiet) notify(kept ? `Merged into ${kept}` : "Merged", () => { void undoMerge(data); });
    return data;
  }, [notify, undoMerge, announce]);

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

  /** Changes a contact's hidden flag or person/company kind on screen at once. The caller saves it and undoes it on failure. */
  const patchContact = useCallback((id: string, patch: ContactPatch) => {
    if ("kindOverride" in patch) rawDispatch({ type: "patchContact", id, patch: { kindOverride: patch.kindOverride ?? undefined } });
    announce({ kind: "patch", id, patch });
  }, [announce]);

  /** Takes a deleted contact out of the store and the Contacts lists. */
  const removeContact = useCallback((id: string) => {
    rawDispatch({ type: "removeContact", id });
    announce({ kind: "remove", id });
    setContactsVersion((v) => v + 1);
  }, [announce]);

  return { refreshContacts, undoMerge, mergeContacts, splitContact, patchContact, removeContact, contactChanges, contactsRefreshed };
}
