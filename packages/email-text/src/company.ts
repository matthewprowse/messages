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
