"use client";

// Layout for /contacts: loads contacts, companies and merge suggestions for the signed-in user, and reloads them when
// contactsVersion changes or Retry is pressed. A list that failed shows an error while the others stay on screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";
import { listContacts, type ContactSummary } from "@/lib/contacts";
import { listContactsFromStore } from "@/lib/data";
import { listCompanies, type CompanySummary } from "@/lib/organizations";
import { listSuggestions, type MergeSuggestion } from "@/lib/contact-merging";
import { CompaniesContext, ContactsShell } from "@/components/contacts-shell";
import { ContactsDataContext } from "@/components/contacts-data";

// Loaded in the browser with the signed-in session, so row-level security returns only your contacts.
export default function ContactsLayout({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  // Adding, merging, splitting or deleting a contact anywhere in the app reloads the lists.
  // When the store holds every contact it lends them, so only the small parts it lacks are read again.
  const { contactsVersion, contactsReady, contacts: stored } = useApp();
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const [contacts, setContacts] = useState<ContactSummary[] | null | undefined>(undefined); // undefined while loading, null if it failed
  const [companies, setCompanies] = useState<CompanySummary[] | null | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<MergeSuggestion[] | null | undefined>(undefined);
  // Bumped by Retry after a list failed to load.
  const [attempt, setAttempt] = useState(0);

  // Only what failed shows loading again; what is on screen stays while the rest reloads.
  useEffect(() => {
    if (!userId || attempt === 0) return;
    setContacts((v) => (v === null ? undefined : v));
    setCompanies((v) => (v === null ? undefined : v));
    setSuggestions((v) => (v === null ? undefined : v));
  }, [userId, attempt]);

  // Its own effect, so the store becoming ready reloads only this list and not the other two.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // Missing someone means the store is behind, so everything is read as before.
    const read = contactsReady ? listContactsFromStore(storedRef.current).then((rows) => rows ?? listContacts()) : listContacts();
    read
      .then((rows) => !cancelled && setContacts(rows))
      .catch((err) => {
        console.error(err instanceof Error ? err.message : "Load contacts failed");
        if (!cancelled) setContacts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, contactsVersion, contactsReady, attempt]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = <T,>(read: () => Promise<T>, set: (value: T | null) => void, label: string) =>
      read()
        .then((rows) => !cancelled && set(rows))
        .catch((err) => {
          console.error(err instanceof Error ? err.message : `${label} failed`);
          if (!cancelled) set(null);
        });
    load(listCompanies, setCompanies, "Load companies");
    load(listSuggestions, setSuggestions, "Load suggestions");
    return () => {
      cancelled = true;
    };
  }, [userId, contactsVersion, attempt]);

  // A rename on the company page shows in the list straight away.
  const renamed = useCallback((id: string, name: string) => {
    setCompanies((list) => list?.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const removeSuggestion = useCallback((id: string) => {
    setSuggestions((list) => list?.filter((s) => s.id !== id));
  }, []);

  // A suggestion for someone no longer listed (merged or split elsewhere) is left out.
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const data = useMemo(() => {
    const ids = new Set((contacts ?? []).map((c) => c.id));
    const shown = contacts && suggestions ? suggestions.filter((s) => ids.has(s.contactA) && ids.has(s.contactB)) : suggestions;
    return { contacts, suggestions: shown, removeSuggestion, reload };
  }, [contacts, suggestions, removeSuggestion, reload]);

  return (
    <CompaniesContext.Provider value={renamed}>
      <ContactsDataContext.Provider value={data}>
        <ContactsShell contacts={contacts} companies={companies}>{children}</ContactsShell>
      </ContactsDataContext.Provider>
    </CompaniesContext.Provider>
  );
}
