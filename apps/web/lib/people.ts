// Which contacts are a company rather than a person. Companies write from role addresses
// (noreply@, info@) or under their own brand name, so they belong on the Companies tab, not in People.
// Pure, so it can be unit tested.

const ROLE_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|noreply[\w.-]*|info|information|hello|hi|hey|support|help|helpdesk|news|newsletters?|marketing|promo(tions)?|offers|deals|team|notifications?|notify|alerts?|updates?|mail|mailer|mailer-daemon|postmaster|bounces?|accounts?|billing|invoices?|orders?|receipts?|service|customer-?service|customercare|care|admin|contact|enquiries|inquiries|sales|members(hip)?|community|digest|events|jobs|careers|recruiting|talent|security|privacy|feedback|reply|automated|system|bot|verify|verification|welcome|rewards|loyalty|store|shop|hr|press|media|legal|reservations|bookings?|travel|statements?|e-?statements?)([._+-].*)?$/i;

const BRAND_WORDS = /\b(team|support|newsletter|notifications?|news|customer|service|rewards|store|shop|official|alerts?|updates?|careers|billing|accounts?|hq|club|app|online|digital|group|inc|ltd|llc|pty|university|college|school|academy|admissions|festival|raceway|services|contracting|subsystem|delivery|notice|notes|dispensary|pharmacy|clinic|hospital|bank|insurance|foundation|restaurant|hotel|lodge|estate|agency|consulting|solutions|studio|labs|technologies|systems|international|data|tickets)\b/i;

// Mail system senders are never people, with or without a company on file.
const SYSTEM_LOCAL = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|donotreply)$/i;

// Words that only appear in automated senders' names, even run together ("Capitec Jobnotification").
const AUTOMATED_PARTS = ["notification", "newsletter", "noreply", "donotreply", "careers", "recruit", "marketing", "customerservice", "customercare", "mailer"];

const squash = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function isRoleAddress(address: string): boolean {
  return ROLE_LOCAL.test(address.split("@")[0] ?? "");
}

/**
 * Whether a display name is a plausible person ("Thandi Mokoena", "T Mokoena") whose name makes up the company
 * domain (thandimokoena, tmokoena, mokoenathandi) and who writes from an address that carries their own name.
 * Both signals are needed so a brand written as two words ("Virgin Active" from virginactive.com) stays a company.
 * org is the squashed organisation name.
 */
function isSoleTraderName(name: string, emails: string[], org: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4 || !words.every((w) => /^\p{L}[\p{L}'’-]*\.?$/u.test(w))) return false;
  if (words.some((w) => BRAND_WORDS.test(w) || ROLE_LOCAL.test(squash(w)) || AUTOMATED_PARTS.some((a) => squash(w).includes(a)))) return false;
  const first = squash(words[0]);
  const last = squash(words[words.length - 1]);
  if (!first || !last) return false;
  const full = squash(name);
  if (!(org === full || org === first + last || org === last + first || org === first[0] + last || org === last + first[0])) return false;
  // The sender's own address names them (thandi@, thandi.mokoena@, tm@), not a shared inbox.
  return emails.some((e) => {
    const local = squash(e.split("@")[0] ?? "");
    return !isRoleAddress(e) && local.length >= 2 && (local.includes(first) || local.includes(last) || local === first[0] + last || local === first[0] + last[0]);
  });
}

/** What isCompanySender and companyLogo read about a contact. */
export interface SenderFacts {
  name: string;
  emails: string[];
  phones: string[];
  organizationName: string | null;
  /** Set by the user ("This Is a Person" or "This Is a Company"); beats every guess below. */
  kindOverride?: string | null;
}

export function isCompanySender(c: SenderFacts): boolean {
  // The user's own word on it wins over the guesses below.
  if (c.kindOverride === "person") return false;
  if (c.kindOverride === "company") return true;
  // Anyone with a phone number is a person. Otherwise only contacts filed under a company move there.
  if (c.phones.length > 0) return false;
  if (c.emails.length > 0 && c.emails.every((e) => SYSTEM_LOCAL.test(e.split("@")[0] ?? ""))) return true;
  if (!c.organizationName) return false;
  if (c.emails.length > 0 && c.emails.every(isRoleAddress)) return true;
  const name = squash(c.name);
  const org = squash(c.organizationName);
  if (!name || !org) return false;
  // "Thandi Mokoena" writing from thandimokoena.co.za is a sole trader: a person who happens to own the domain.
  if (isSoleTraderName(c.name, c.emails, org)) return false;
  // "Emirates" or "Emirates Skywards" from emirates.com, but not "Andrew Stegmann | Relocation Africa".
  if (name === org || name.startsWith(org)) return true;
  // "Adam from UX Pilot", "Kate at Notion", "Max Bishop via LinkedIn" or "Geordin on LinkedIn": a person's
  // name used by the company's own sender. Any separator will do, as in "Don on Hill via LinkedIn".
  for (const from of c.name.matchAll(/\s(?:from|at|@|via|on)\s+(?=(.+$))/gi)) if (squash(from[1]).startsWith(org)) return true;
  // No display name, so the name was made from a run-together address ("Customerenquiries").
  if (!/\s/.test(c.name.trim()) && name.length >= 8 && c.emails.some((e) => squash(e.split("@")[0] ?? "") === name)) return true;
  // A name that is itself a role word ("Information", "Support"), or carries an automated word.
  if (ROLE_LOCAL.test(name) || AUTOMATED_PARTS.some((w) => name.includes(w))) return true;
  return BRAND_WORDS.test(c.name);
}

/** Marks an avatar path as a shared company logo (lib/logo-paths.ts says which bucket), not a photo in "avatars". */
export const LOGO_AVATAR = "logos:";

/** A company's shared logo (organizations.logo_path) as an avatar path, or undefined while it has none. */
export function logoAvatar(path: string | null | undefined): string | undefined {
  return path ? LOGO_AVATAR + path : undefined;
}

/**
 * The company's logo, to show in place of a photo for a sender that writes as the company itself
 * ("LinkedIn", "Dan from Relume", "Google Cloud"), or undefined. A sender whose name does not mention the
 * company gets none: mail sent through a hiring or mailing service ("Capitec Jobnotification" from
 * jobs2web.com) is not that service's.
 */
export function companyLogo(c: SenderFacts, logoPath: string | null | undefined): string | undefined {
  if (!logoPath || !c.organizationName || !isCompanySender(c)) return undefined;
  const name = squash(c.name);
  const org = squash(c.organizationName);
  if (!name || !org) return undefined;
  return name.includes(org) || (name.length >= 4 && org.startsWith(name)) ? logoPath : undefined;
}
