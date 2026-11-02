// Same-matter links between conversations (public.thread_links), as the person timeline needs them: the rows mapped to app
// types, the groups that linked threads form, and the suggestions still waiting for a yes or no. Pure; use-thread-links.ts does the I/O.

export type LinkStatus = "suggested" | "linked" | "dismissed";

export interface ThreadLink {
  id: string;
  /** The pair, stored in id order (threadA < threadB) so a pair has one row. */
  threadA: string;
  threadB: string;
  contactId?: string;
  status: LinkStatus;
  score: number;
  /** How it was found: the rules alone, a borderline pair the model confirmed, or linked by hand. */
  source: "similarity" | "ai" | "manual";
}

interface LinkRow { id: string; thread_a: string; thread_b: string; contact_id: string | null; status: string; score: number; source: string }

/** A database row as a link. An unknown status reads as dismissed, so a value from a newer version never links anything. */
export function mapLink(r: LinkRow): ThreadLink {
  return {
    id: r.id,
    threadA: r.thread_a,
    threadB: r.thread_b,
    contactId: r.contact_id ?? undefined,
    status: r.status === "suggested" || r.status === "linked" ? r.status : "dismissed",
    score: r.score,
    source: r.source === "ai" || r.source === "manual" ? r.source : "similarity",
  };
}

/** The two thread ids in the order the table stores them. */
export function pairOrder(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Groups of conversations the person has linked as one matter, each with two or more thread ids from `among`. A link
 * chains: A with B and B with C is one matter. Order inside a group follows `among`.
 */
export function matterGroups(links: ThreadLink[], among: string[]): string[][] {
  const inScope = new Set(among);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    parent.set(x, r);
    return r;
  };
  for (const l of links) {
    if (l.status !== "linked" || !inScope.has(l.threadA) || !inScope.has(l.threadB)) continue;
    if (!parent.has(l.threadA)) parent.set(l.threadA, l.threadA);
    if (!parent.has(l.threadB)) parent.set(l.threadB, l.threadB);
    parent.set(find(l.threadA), find(l.threadB));
  }
  const groups = new Map<string, string[]>();
  for (const id of among) {
    if (!parent.has(id)) continue;
    const root = find(id);
    const g = groups.get(root);
    if (g) g.push(id); else groups.set(root, [id]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Suggestions still to answer, both of whose conversations are among `among`, the surest first. */
export function pendingSuggestions(links: ThreadLink[], among: string[]): ThreadLink[] {
  const inScope = new Set(among);
  return links.filter((l) => l.status === "suggested" && inScope.has(l.threadA) && inScope.has(l.threadB)).sort((a, b) => b.score - a.score);
}
