// One sign-in connects several parts (Gmail, Calendar and Tasks), each its own account row for the workers.
// The person has one Google, so Settings shows one row per sign-in. Rows are paired by order within a family
// when there are several sign-ins of one family.

import type { Account, Provider } from "./types";

export type Family = "google" | "microsoft" | "apple" | Provider;

const FAMILY: Partial<Record<Provider, Family>> = {
  gmail: "google", google_calendar: "google", google_tasks: "google", google_meet: "google",
  outlook: "microsoft", outlook_calendar: "microsoft", microsoft_todo: "microsoft", teams: "microsoft",
  icloud: "apple", icloud_calendar: "apple", icloud_reminders: "apple",
};

export const FAMILY_NAME: Record<string, string> = { google: "Google", microsoft: "Microsoft", apple: "iCloud" };

/** What each part is called in the list of what a sign-in connected. */
const PART_NAME: Partial<Record<Provider, string>> = {
  gmail: "Gmail", google_calendar: "Calendar", google_tasks: "Tasks", google_meet: "Meet",
  outlook: "Outlook", outlook_calendar: "Calendar", microsoft_todo: "To Do", teams: "Teams",
  icloud: "Mail", icloud_calendar: "Calendar", icloud_reminders: "Reminders",
};

export const familyOf = (p: Provider): Family => FAMILY[p] ?? p;

export interface AccountGroup {
  key: string;
  family: Family;
  accounts: Account[];
}

export function groupAccounts(accounts: Account[]): AccountGroup[] {
  const groups: AccountGroup[] = [];
  // For a family, the i-th account of each provider belongs to the i-th sign-in.
  const slots = new Map<string, AccountGroup[]>();
  const seen = new Map<string, number>();
  for (const a of accounts) {
    const family = familyOf(a.provider);
    if (family === a.provider) {
      groups.push({ key: a.id, family, accounts: [a] });
      continue;
    }
    const n = seen.get(`${a.provider}`) ?? 0;
    seen.set(`${a.provider}`, n + 1);
    const list = slots.get(family) ?? [];
    let group = list[n];
    if (!group) {
      group = { key: `${family}-${n}`, family, accounts: [] };
      list[n] = group;
      slots.set(family, list);
      groups.push(group);
    }
    group.accounts.push(a);
  }
  return groups;
}

/** "Gmail, Calendar, Tasks": the parts this sign-in connected. */
export function partsOf(group: AccountGroup): string {
  const order = Object.keys(PART_NAME);
  return [...group.accounts].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider)).map((a) => PART_NAME[a.provider] ?? a.label).join(", ");
}

/** One status for the sign-in: a part needing attention wins, then one still connecting, then any working. */
export function groupStatus(group: AccountGroup): Account["status"] {
  const s = group.accounts.map((a) => a.status);
  if (s.includes("error")) return "error";
  if (s.includes("connecting")) return "connecting";
  if (s.includes("syncing")) return "syncing";
  if (s.includes("connected")) return "connected";
  return "disconnected";
}

/** Why a sign-in needs attention: the failing part and what it said. */
export function groupProblem(group: AccountGroup): string | undefined {
  const bad = group.accounts.find((a) => a.status === "error" && a.statusDetail) ?? group.accounts.find((a) => a.status !== "connected" && a.statusDetail);
  return bad?.statusDetail ? `${PART_NAME[bad.provider] ?? bad.label}: ${bad.statusDetail}` : undefined;
}
