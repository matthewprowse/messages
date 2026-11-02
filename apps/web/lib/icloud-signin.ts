// The small rules of the one iCloud sign-in, shared by its form and its routes so both agree: which address signs in to
// iCloud Mail, and which services were ticked.

export type ICloudService = "mail" | "calendar" | "reminders";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An Apple address that is also an iCloud Mail address. Any other Apple ID needs its iCloud Mail address typed. */
export function isICloudAddress(value: string): boolean {
  return /@(icloud|me|mac)\.com$/i.test(value.trim());
}

/**
 * The name iCloud Mail and Calendar sign in with: the iCloud Mail address typed, else the Apple ID when it is one.
 * Null when Mail is wanted and there is none, which the form asks for.
 */
export function mailLogin(appleId: string, mailAddress: string): string | null {
  const typed = mailAddress.trim().toLowerCase();
  if (typed) return EMAIL.test(typed) ? typed : null;
  return isICloudAddress(appleId) ? appleId.trim().toLowerCase() : null;
}

/** The ticked services in a fixed order, or null when none is ticked. */
export function chosenServices(ticked: Partial<Record<ICloudService, unknown>>): ICloudService[] | null {
  const services = (["mail", "calendar", "reminders"] as const).filter((s) => ticked[s] === true);
  return services.length ? services : null;
}

/** Where a sign-in is, as /api/connect/icloud-signin/step reports it. */
export type SetupState = {
  status: "working" | "code" | "done" | "failed";
  method?: "app" | "sms" | null;
  attempts?: number;
  detail?: string | null;
  error?: string;
  connected?: { mail: boolean; calendar: boolean; remindersAccountId: string | null };
};

/** What to say once the sign-in has connected what it could. */
export function connectedMessage(done: { mail: boolean; calendar: boolean; reminders: boolean }, wanted?: { mail: boolean; calendar: boolean }): string {
  const parts = [done.mail && "Mail", done.calendar && "Calendar"].filter(Boolean) as string[];
  const saved = parts.length ? `iCloud ${parts.join(" and ")} ${parts.length > 1 ? "are" : "is"} connected.` : "";
  const missed = wanted?.calendar && !done.calendar && done.mail ? " Calendar did not accept the same sign-in." : "";
  const reminders = done.reminders ? `${saved ? " " : ""}Reminders is signing in.` : "";
  return `${saved}${missed}${reminders}` || "iCloud is connected.";
}

// The iCloud connector takes a queued sign-in within seconds; one still waiting after this is not being taken.
const UNTAKEN_MS = 45_000;

/** Whether a queued sign-in has waited longer than the connector ever takes to pick one up. */
export function untaken(createdAt: string, now = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > UNTAKEN_MS;
}
