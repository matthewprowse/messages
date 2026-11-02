// Types and constants for the numbers on the Analytics page. The database computes the summary now; the page only
// needs these shapes and the list of splits it can show.

export interface Stat {
  value: number;
  /** The same count over the period just before, for the change. */
  prev: number;
}

export interface Counted {
  key: string;
  n: number;
}

export const DIMENSIONS = ["sender", "channel", "bulk", "attach", "len", "hour", "known", "source", "prompt"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type LabelFieldName = "priority" | "category" | "junk";
