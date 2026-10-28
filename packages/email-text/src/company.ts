// Which company an email address belongs to: the rules public.mail_domain_root, is_personal_mail_domain,
// organization_name_for_domain and organization_for_address had in SQL (20261023000000_round_two.sql).
// They move here because addresses are stored encrypted (encryption stage 2), so the database can no
// longer read the domain. The sync worker and the browser both use them.

const COUNTRY_SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "gen", "web", "nom", "or", "ne", "go", "mil", "sch"]);
const HELP_DESKS = new Set(["zendesk.com", "freshdesk.com"]);

const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "icloud.com", "me.com", "mac.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "yahoo.com", "ymail.com", "rocketmail.com", "aol.com", "proton.me",
  "protonmail.com", "protonmail.ch", "pm.me", "gmx.com", "gmx.net", "gmx.de", "web.de", "mail.com",
  "zohomail.com", "yandex.com", "yandex.ru", "mail.ru", "hey.com", "fastmail.com",
  "fastmail.fm", "tutanota.com", "tuta.io", "qq.com", "163.com", "126.com", "naver.com", "hushmail.com",
  "telkomsa.net", "vodamail.co.za", "webmail.co.za", "btinternet.com",
]);
// Country editions of the big webmail brands: hotmail.co.uk, yahoo.co.za, outlook.co.za and so on.
const PERSONAL_BRANDS = new Set(["gmail", "googlemail", "hotmail", "outlook", "live", "msn", "yahoo", "ymail", "icloud", "aol", "protonmail", "gmx", "yandex"]);

/**
 * The registrable domain mail comes from, so mail.example.com and e.example.com are one company. Two-part
 * country suffixes such as co.za keep three labels; help desks that host many companies
 * (cottonon.zendesk.com) keep the company's own label.
 */
export function mailDomainRoot(domain: string | null | undefined): string | null {
  const labels = (domain ?? "").trim().toLowerCase().replace(/^\.+|\.+$/g, "").split(".");
  const count = labels.length;
  if (!labels[0]) return null;
  let keep = 2;
  if (count >= 3 && labels[count - 1].length === 2 && COUNTRY_SECOND_LEVEL.has(labels[count - 2])) keep = 3;
  if (count > keep && HELP_DESKS.has(labels.slice(count - keep).join("."))) keep++;
  return count <= keep ? labels.join(".") : labels.slice(count - keep).join(".");
}

/** A personal mail provider: an address there says nothing about where someone works. */
export function isPersonalMailDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  return PERSONAL.has(d) || PERSONAL_BRANDS.has((mailDomainRoot(d) ?? "").split(".")[0]);
}

/** A readable default name from the domain's main label: big-talent.co.za is Big Talent. */
export function companyNameForDomain(domain: string): string {
  // initcap, as Postgres did it: the first letter of each word upper and the rest lower, where a word is a
  // run of letters, digits and apostrophes.
  return domain.split(".")[0].replace(/[-_]/g, " ").toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, gap: string, c: string) => gap + c.toUpperCase());
}

const domainOf = (address: string) => {
  const at = address.indexOf("@");
  return at < 0 ? null : mailDomainRoot(address.slice(at + 1).split("@")[0]);
};

/**
 * The company domain for an email address, or null for personal providers, a domain without a dot, and
 * your own domains (colleagues on your own domain are people, not a company you deal with). own is every
 * address on your accounts, including send addresses.
 */
export function companyDomain(address: string, own: Iterable<string>): string | null {
  const domain = domainOf(address.trim().toLowerCase());
  if (!domain || !domain.includes(".") || isPersonalMailDomain(domain)) return null;
  for (const mine of own) if (mine.includes("@") && domainOf(mine.trim().toLowerCase()) === domain) return null;
  return domain;
}

const squash = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The company a shared sender writes for: "LinkedIn" in "Nicholas van Schalkwyk via LinkedIn" or
 * "Geordin Hill-Lewis on LinkedIn", else null. Services send everyone's notifications from one address
 * under the person's name, so such a name says who the notice is about, not who sent it.
 */
export function viaCompany(displayName: string | null | undefined): string | null {
  const m = (displayName ?? "").trim().match(/^.+?\s(?:via|on)\s+(\S.*)$/i);
  return m ? m[1].trim() : null;
}

/**
 * The company's name for a domain, written as the company writes it when the sender's display name is
 * just that name ("LinkedIn" from linkedin.com, "Prime Video" from primevideo.com) or ends in it
 * ("Geordin Hill-Lewis on LinkedIn"), else the readable default from the domain (companyNameForDomain).
 */
export function companyNameFor(domain: string, displayName?: string | null): string {
  const name = viaCompany(displayName) ?? displayName?.trim() ?? "";
  const label = squash(domain.split(".")[0]);
  if (name && label && squash(name) === label && name.length <= 40) return name;
  return companyNameForDomain(domain);
}

// Names that only say the sender is automated, never who it is: "No Reply", "noreply", "Do Not Reply",
// "Notifications", "Mailer Daemon".
const PLACEHOLDER_NAME = /^(no[\s._-]*reply|do[\s._-]*not[\s._-]*reply|no[\s._-]*response|mailer[\s._-]*daemon|postmaster|auto[\s._-]*reply|automated|notifications?|notify|alerts?|info|information|news(letters?)?|hello|support|team|mail(er)?|bounces?|system|admin|updates?)$/i;
// Local parts of automated addresses, whose made-up name ("Noreplycapetownnewlands") is no name at all.
// A local part that names something besides the role ("capitec-jobnotification") keeps its name.
const AUTOMATED_LOCAL = /(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|^(info|news|hello|mail|mailer|support|team|updates?|alerts?|notifications?|newsletters?|bounces?)$)/i;

/** True when a sender's name says nothing about who sent it: missing, an address, or a word like "No Reply". */
export function isPlaceholderName(name: string | null | undefined, address: string): boolean {
  const n = (name ?? "").trim();
  if (!n || /^\S+@\S+\.\S+$/.test(n)) return true;
  if (PLACEHOLDER_NAME.test(n) || /no-?reply|donotreply/i.test(squash(n))) return true;
  // A name made from the address ("Noreply", "Info"), for an automated address.
  const local = address.split("@")[0] ?? "";
  return squash(n) === squash(local) && AUTOMATED_LOCAL.test(local);
}

/**
 * The name to show for an email sender: their display name, or for an automated sender that gives none
 * (or only "No Reply") or writes "<person> via <Company>", the company it belongs to. `fromAddress` makes a name from the address itself
 * when there is no company (sarah.okafor@x.com is Sarah Okafor).
 */
export function senderName(address: string, displayName: string | null | undefined, company: string | null, fromAddress: (address: string) => string): string {
  const name = displayName?.trim() ?? "";
  // "Max Bishop via LinkedIn" from the company's own address is the company: the address is shared by
  // everyone it writes about, so it must not be named after one of them.
  const via = viaCompany(name);
  if (company && via && squash(via).startsWith(squash(company))) return company;
  if (!isPlaceholderName(name, address)) return name;
  if (company) return company;
  return name && !name.includes("@") ? name : fromAddress(address);
}
