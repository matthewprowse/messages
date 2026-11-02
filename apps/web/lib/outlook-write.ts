// Asking for permission to change Outlook Calendar. The Microsoft sign-in reads the calendar; creating, changing,
// answering and deleting events needs Calendars.ReadWrite on top, asked for on its own (incremental consent) when the
// worker says it was not allowed. Kept apart from the dialogs so the wording and the check can be unit tested.

/** The worker's reason for a refused Outlook change (apps/worker/src/microsoft/calendar-write.ts WRITE_NOT_GRANTED). */
export function needsOutlookWrite(error: string | null | undefined): boolean {
  return !!error && /outlook calendar has not been allowed to make changes/i.test(error);
}

/** The sentence shown with the Allow Editing button. */
export const OUTLOOK_WRITE_TEXT = "Konva can read your Outlook Calendar but has not been allowed to change it. Allow editing, sign in to Microsoft again, then repeat what you were doing.";

/**
 * Off to Microsoft to agree to Calendars.ReadWrite, back to Connected Accounts afterwards. `teams` keeps the Teams
 * permissions when that account has them, as the new sign-in replaces the stored one.
 */
export async function allowOutlookEditing(teams: boolean): Promise<void> {
  // Imported here so the check above stays free of the browser's database client and can be unit tested.
  const { postAsUser } = await import("./onboarding");
  const { url } = await postAsUser<{ url: string }>("/api/connect/microsoft", { back: "/settings/accounts/microsoft", teams, calendarWrite: true });
  window.location.assign(url);
}
