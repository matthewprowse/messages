// The tone drafts are written in unless you ask for another (profiles.draft_tone, read by the AI worker). Pure.

export const DRAFT_TONES = [
  { value: "formal", label: "Formal" },
  { value: "friendly", label: "Friendly" },
  { value: "brief", label: "Brief" },
] as const;

export type DraftTone = (typeof DRAFT_TONES)[number]["value"];

/** A stored value as a tone, or null for the usual voice when it is empty or unknown. */
export function toDraftTone(value: string | null | undefined): DraftTone | null {
  return DRAFT_TONES.find((t) => t.value === value)?.value ?? null;
}
