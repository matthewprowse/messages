"use client";

// Layout for /contacts: loads contacts (with their star, relationship and last message each way), companies and merge suggestions for the signed-in user. A merge, hide, change of
// kind or delete is patched into the lists as the store announces it (contactChanges), and the lists are read again only
// after a full contact reload or Retry. Companies load when the Companies tab or a company is first opened.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { listContacts, type ContactSummary } from "@/lib/contacts";
import { applyRelations } from "@/lib/contact-relations";
import { loadRelations } from "@/lib/contact-relations-io";
import { listContactsFromStore } from "@/lib/data";
import { listCompanies, type CompanySummary } from "@/lib/organizations";
import { listSuggestions, type MergeSuggestion } from "@/lib/contact-merging";
import { mergeCompanies, mergeSuggestions, mergeSummaries, patchSummary, removeSummary } from "@/lib/contact-list-patch";
import { CompaniesContext, ContactsShell } from "@/components/contacts-shell";
import { ContactsDataContext } from "@/components/contacts-data";

// Loaded in the browser with the signed-in session, so row-level security returns only your contacts.
export default function ContactsLayout({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  // When the store holds every contact it lends them, so only the small parts it lacks are read again.
  const { contactsReady, contactsRefreshed, contactChanges, contacts: stored } = useApp();
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const [contacts, setContacts] = useState<ContactSummary[] | null | undefined>(undefined); // undefined while loading, null if it failed
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const [companies, setCompanies] = useState<CompanySummary[] | null | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<MergeSuggestion[] | null | undefined>(undefined);
  // How many pending suggestions the first page did not include.
  const [suggestionsMore, setSuggestionsMore] = useState(0);
  // Companies cost a query of their own, so they load once the Companies tab (or a search that could match one) asks.
  const [wantCompanies, setWantCompanies] = useState(false);
  // Bumped by Retry after a list failed to load.
  const [attempt, setAttempt] = useState(0);

  // Only what failed shows loading again; what is on screen stays while the rest reloads.
  useEffect(() => {
    if (!userId || attempt === 0) return;
    setContacts((v) => (v === null ? undefined : v));
    setCompanies((v) => (v === null ? undefined : v));
    setSuggestions((v) => (v === null ? undefined : v));
  }, [userId, attempt]);

  // Its own effect, so the store becoming ready reloads only this list and not the other two. While a full contact reload
  // is under way (the store not ready) the list on screen stays; it reads once when the store is ready again.
  useEffect(() => {
    if (!userId) return;
    if (!contactsReady && contactsRef.current) return;
    let cancelled = false;
    // Missing someone means the store is behind, so everything is read as before.
    const read = contactsReady ? listContactsFromStore(storedRef.current).then((rows) => rows ?? listContacts()) : listContacts();
    // The star, relationship and last message each way. If they cannot be read the list still shows, without them.
    const relations = loadRelations().catch((err) => {
      console.error(err instanceof Error ? err.message : "Load relationships failed");
      return null;
    });
    Promise.all([read, relations])
      .then(([rows, found]) => !cancelled && setContacts(found ? applyRelations(rows, found) : rows))
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load contacts failed");
        if (!cancelled) setContacts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, contactsReady, contactsRefreshed, attempt]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    listSuggestions()
      .then(({ rows, total }) => {
        if (cancelled) return;
        setSuggestions(rows);
        setSuggestionsMore(Math.max(0, total - rows.length));
      })
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load suggestions failed");
        if (!cancelled) setSuggestions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, contactsRefreshed, attempt]);

  useEffect(() => {
    if (!userId || !wantCompanies) return;
    let cancelled = false;
    listCompanies()
      .then((rows) => !cancelled && setCompanies(rows))
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load companies failed");
        if (!cancelled) setCompanies(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, wantCompanies, contactsRefreshed, attempt]);

  // Merges, hides, changes of kind and deletes announced by the store since this layout last looked, applied in order.
  const seen = useRef(contactChanges.length);
  useEffect(() => {
    const fresh = contactChanges.slice(seen.current);
    seen.current = contactChanges.length;
    for (const change of fresh) {
      if (change.kind === "merge") {
        const gone = contactsRef.current?.find((c) => c.id === change.mergeId);
        setContacts((list) => list && mergeSummaries(list, change.keepId, change.mergeId, change.name));
        setSuggestions((list) => list && mergeSuggestions(list, change.keepId, change.mergeId));
        setCompanies((list) => list && mergeCompanies(list, gone));
      } else if (change.kind === "patch") {
        const { kindOverride, hidden } = change.patch;
        setContacts((list) => list && patchSummary(list, change.id, {
          ...(hidden !== undefined && { hidden }),
          ...("kindOverride" in change.patch && { kindOverride: kindOverride ?? undefined }),
        }));
      } else {
        setContacts((list) => list && removeSummary(list, change.id));
      }
    }
  }, [contactChanges]);

  // A rename on the company page shows in the list straight away.
  const renamed = useCallback((id: string, name: string) => {
    setCompanies((list) => list?.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const removeSuggestion = useCallback((id: string) => {
    setSuggestions((list) => list?.filter((s) => s.id !== id));
  }, []);
  // Puts a suggestion back where it was when dismissing it could not be saved.
  const restoreSuggestion = useCallback((s: MergeSuggestion) => {
    setSuggestions((list) => (list && !list.some((x) => x.id === s.id) ? [...list, s].sort((a, b) => b.score - a.score) : list));
  }, []);
  const needCompanies = useCallback(() => setWantCompanies(true), []);
  const patchContact = useCallback((id: string, patch: Partial<ContactSummary>) => setContacts((list) => list && patchSummary(list, id, patch)), []);

  // A suggestion for someone no longer listed (merged or split elsewhere) is left out.
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const data = useMemo(() => {
    const ids = new Set((contacts ?? []).map((c) => c.id));
    const shown = contacts && suggestions ? suggestions.filter((s) => ids.has(s.contactA) && ids.has(s.contactB)) : suggestions;
    return { contacts, suggestions: shown, suggestionsMore, removeSuggestion, restoreSuggestion, needCompanies, reload, patchContact };
  }, [contacts, suggestions, suggestionsMore, removeSuggestion, restoreSuggestion, needCompanies, reload, patchContact]);

  return (
    <CompaniesContext.Provider value={renamed}>
      <ContactsDataContext.Provider value={data}>
        <ContactsShell contacts={contacts} companies={companies}>{children}</ContactsShell>
      </ContactsDataContext.Provider>
    </CompaniesContext.Provider>
  );
}
