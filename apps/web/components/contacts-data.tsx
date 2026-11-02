"use client";

// React context for the data the Contacts layout loads once (contacts, companies, merge suggestions), so the list and the pages beside it share it.

import { createContext, useContext } from "react";
import type { ContactSummary } from "@/lib/contacts";
import type { MergeSuggestion } from "@/lib/contact-merging";

/** What the Contacts layout loads once and shares with the list, the contact page and Suggested Merges. */
export interface ContactsData {
  /** undefined while loading, null if it failed. */
  contacts: ContactSummary[] | null | undefined;
  /** Pending suggestions whose two people are both still listed. */
  suggestions: MergeSuggestion[] | null | undefined;
  /** How many more pending suggestions there are than the page loaded. */
  suggestionsMore: number;
  /** Takes a suggestion off the list straight away, after Merge or Not the Same. */
  removeSuggestion: (id: string) => void;
  /** Puts a suggestion back, when dismissing it could not be saved. */
  restoreSuggestion: (suggestion: MergeSuggestion) => void;
  /** Asks the layout to load the companies, which it does not until something needs them. */
  needCompanies: () => void;
  /** Loads the contacts, companies and suggestions again, after one of them failed to load. */
  reload: () => void;
}

export const ContactsDataContext = createContext<ContactsData>({
  contacts: undefined,
  suggestions: undefined,
  suggestionsMore: 0,
  removeSuggestion: () => {},
  restoreSuggestion: () => {},
  needCompanies: () => {},
  reload: () => {},
});

export function useContactsData() {
  return useContext(ContactsDataContext);
}
