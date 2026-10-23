"use client";

import { createContext, useContext } from "react";
import type { ContactSummary } from "@/lib/contacts";
import type { MergeSuggestion } from "@/lib/contact-merging";

/** What the Contacts layout loads once and shares with the list, the contact page and Suggested Merges. */
export interface ContactsData {
  /** undefined while loading, null if it failed. */
  contacts: ContactSummary[] | null | undefined;
  /** Pending suggestions whose two people are both still listed. */
  suggestions: MergeSuggestion[] | null | undefined;
  /** Takes a suggestion off the list straight away, after Merge or Not the Same. */
  removeSuggestion: (id: string) => void;
}

export const ContactsDataContext = createContext<ContactsData>({ contacts: undefined, suggestions: undefined, removeSuggestion: () => {} });

export function useContactsData() {
  return useContext(ContactsDataContext);
}
