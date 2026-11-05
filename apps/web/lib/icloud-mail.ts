// Rules for connecting iCloud Mail, shared by the connect form and the server: what the form starts with, and which
// account a new app-specific password belongs to. Pure, so they are tested without a database.

/** Apple's own mail domains: an address on one is an iCloud Mail sign-in. */
const APPLE_MAIL = /@(icloud|me|mac)\.com$/i;

/** Free mail providers. An address there can be an Apple ID, but never an iCloud+ custom domain address. */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "zoho.com", "mail.com", "yandex.com",
]);

export function isFreeMail(email: string): boolean {
  return FREE_MAIL.has(email.trim().toLowerCase().split("@")[1] ?? "");
}

/**
 * What the iCloud form starts with, from the email the person signs in to Konva with: an Apple address is the
 * iCloud Mail sign-in, any other address of their own is taken for an iCloud+ custom domain, and a free mail
 * address is neither, so the form starts empty.
 */
export function icloudPrefill(email: string): { username: string; address: string } {
  const value = email.trim();
  if (!value || isFreeMail(value)) return { username: "", address: "" };
  return APPLE_MAIL.test(value) ? { username: value, address: "" } : { username: "", address: value };
}

/**
 * The iCloud Mail account a sign-in belongs to: the oldest with the same sign-in name, whatever its address, so a
 * new app-specific password reconnects it instead of adding a second copy of the same mailbox. Null when none has.
 */
export function accountForSignIn<T extends { createdAt: string; username: string | null }>(accounts: T[], username: string): T | null {
  const wanted = username.trim().toLowerCase();
  const same = accounts.filter((a) => a.username?.trim().toLowerCase() === wanted);
  return same.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}
