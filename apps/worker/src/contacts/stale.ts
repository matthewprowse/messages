// Which pending contact suggestions the linker removes after a run: the pairs it no longer finds. Pure: linker.ts
// loads the rows and deletes the ids. A suggestion another part of the app made (an automation's "suggest merge",
// evidence {"source": "automation"}) is not the linker's to judge, so it stays until you decide it.

import type { Json } from "@messages/db";
import { pairKey } from "./match";

/** A contact_suggestions row as the linker loads it. */
export interface SuggestionRow {
  id: string;
  contact_a: string;
  contact_b: string;
  status: string;
  evidence?: Json | null;
}

/** True for a suggestion something other than the linker made. */
export function madeElsewhere(evidence: Json | null | undefined): boolean {
  return !!evidence && typeof evidence === "object" && !Array.isArray(evidence) && evidence.source === "automation";
}

/** Ids of the pending suggestions to delete: the linker's own pairs it did not find again this run. rep maps a
 *  contact merged this run to the one kept; wanted holds the pairKey of every pair found. */
export function staleSuggestions(decided: SuggestionRow[], wanted: { has(key: string): boolean }, rep: (id: string) => string): string[] {
  return decided
    .filter((s) => s.status === "pending" && !madeElsewhere(s.evidence) && !wanted.has(pairKey(rep(s.contact_a), rep(s.contact_b))))
    .map((s) => s.id);
}
