// "Check in with Sipho in 2 weeks": the plan for a follow-up reminder made from a contact's page. It becomes an ordinary
// task through the same queue as New Task (contact-nudge-io.ts), so it shows in Tasks and the calendar and syncs to the
// user's own task list. Pure.

import { addDays, dayKey } from "./dates";
import type { Account } from "./types";
import { TASK_PROVIDERS, type TaskForm } from "./tasks";

/** The reminders offered on a contact, as days from today. */
export const NUDGES = [
  { key: "3d", label: "In 3 Days", days: 3 },
  { key: "1w", label: "In 1 Week", days: 7 },
  { key: "2w", label: "In 2 Weeks", days: 14 },
  { key: "1m", label: "In 1 Month", days: 30 },
] as const;

export type NudgeKey = (typeof NUDGES)[number]["key"];

/** A first name to put in the title: the first word of a real name, else the whole name (a number or an address). */
export function firstNameOf(name: string): string {
  const text = name.trim();
  if (!text || /[@\d]/.test(text)) return text || "Them";
  return text.split(/\s+/)[0];
}

/** The task account a reminder goes to: the first connected one that takes tasks, or undefined when there is none. */
export function nudgeAccount(accounts: Pick<Account, "id" | "provider" | "status">[]): Pick<Account, "id" | "provider" | "status"> | undefined {
  return accounts.find((a) => (TASK_PROVIDERS as readonly string[]).includes(a.provider) && a.status !== "disconnected");
}

/** The task form for a reminder: a title naming the person, due that many days from today, all day. */
export function nudgeForm(name: string, accountId: string, days: number, now: Date = new Date()): TaskForm {
  return { title: `Check In With ${firstNameOf(name)}`, notes: "", accountId, date: dayKey(addDays(now, days)), time: "", priority: 0 };
}
