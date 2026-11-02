// The small grey line under a learned style rule in Settings, What Drafts Use. A rule learned from a single edit starts switched
// off as "tentative" (the AI worker, apps/ai/ai/rules.py) and goes live when a second edit supports it; until then it said
// nothing, so it looked broken. Pure, so the wording is tested.

export interface RuleNoteInput {
  /** The name of the person it is for, or "" when it is for everyone. */
  who: string;
  supportCount: number;
  enabled: boolean;
  disabledReason: string | null;
}

export function ruleNote({ who, supportCount, enabled, disabledReason }: RuleNoteInput): string {
  const tentative = !enabled && disabledReason === "tentative";
  return [
    who ? `For ${who}` : "Everyone",
    tentative ? "Learning: seen once" : supportCount > 1 ? `Seen ${supportCount} times` : "",
    !enabled && disabledReason === "unsupported" ? "No Longer Seen In Your Mail" : "",
  ].filter(Boolean).join(" · ");
}
