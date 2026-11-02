// Rules for Auto labels: a label the AI may put on a conversation by itself, with a one-line description of what belongs
// under it. At most AUTO_MAX per person (the database enforces the same), and the description is the person's own text,
// sealed with their key before it is stored. No React, no database.

/** How many labels may be Auto at once. */
export const AUTO_MAX = 6;
/** Longest description: one line the AI reads for every email, so it stays short. */
export const DESCRIPTION_MAX = 120;

/** What the screen holds for a label's Auto setting. */
export interface AutoSetting {
  auto: boolean;
  description: string;
}

/** A typed description tidied to one line and cut to DESCRIPTION_MAX. */
export function cleanDescription(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_MAX).trim();
}

/** How many labels are Auto. */
export const autoCount = (settings: Map<string, AutoSetting>) => [...settings.values()].filter((s) => s.auto).length;

/** Whether this label may be turned on: it is on already, or there is room. */
export function canTurnOn(settings: Map<string, AutoSetting>, labelId: string): boolean {
  return settings.get(labelId)?.auto === true || autoCount(settings) < AUTO_MAX;
}

/** An Auto label with no description cannot tell the AI what belongs under it, so it is not usable yet. */
export const isUsable = (s: AutoSetting | undefined) => !!s && s.auto && cleanDescription(s.description).length > 0;
