// Why a calendar account cannot take queued work. Pure: no network, no database. The calendar dispatcher
// (runtime/dispatch-calendar.ts) fails a queued row with this wording instead of handing it on.

export type CalendarAccount = { id: string; provider: string; status: string };

/** Why a calendar account cannot take queued work, or null when it can. */
export function calendarAccountProblem(account: CalendarAccount, verb: "added to" | "deleted from" | "changed in"): string | null {
  const outlook = account.provider === "outlook_calendar";
  if (account.provider !== "google_calendar" && account.provider !== "icloud_calendar" && !outlook) {
    return `Events can only be ${verb} a Google, Outlook or iCloud Calendar account.`;
  }
  if (account.status === "error" || account.status === "disconnected") {
    if (account.provider === "icloud_calendar") return "iCloud Calendar needs attention. Reconnect iCloud Calendar in Settings, Accounts, then try again.";
    if (outlook) return "Outlook Calendar needs attention. Reconnect Outlook Calendar in Settings, Accounts, then try again.";
    return "Google Calendar needs attention. Reconnect Google in Settings, Connected Accounts, then try again.";
  }
  return null;
}
