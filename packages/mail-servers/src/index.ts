// Where any mailbox's IMAP and SMTP servers are: built-in presets for common hosts, Mozilla's autoconfig files,
// and a guess from the domain's MX records. No I/O here: DNS and HTTP are passed in, so it can be unit tested.
// The app's connect route and pnpm connect:imap work the settings out and check them (./probe); the worker
// connects with what they saved. iCloud is a preset too, the one the iCloud connector uses.

/** IMAP over TLS from the start (port 993), or plain then upgraded with STARTTLS (port 143). */
export type ImapTls = "tls" | "starttls";
/** SMTP over SSL from the start (port 465), or plain then upgraded with STARTTLS (port 587). */
export type SmtpSecurity = "ssl" | "starttls";

export interface ImapServer {
  host: string;
  port: number;
  tls: ImapTls;
}

export interface SmtpServer {
  host: string;
  port: number;
  security: SmtpSecurity;
}

/** One mailbox's servers and sign-in name, as saved with its password. */
export interface ServerSettings {
  imap: ImapServer;
  smtp: SmtpServer;
  /** Usually the email address. */
  username: string;
}

/** Servers worked out for an address, to try in order, best first. */
export interface Candidates {
  imap: ImapServer[];
  smtp: SmtpServer[];
  username: string;
  /** Where they came from: a built-in preset, an autoconfig file, or a guess from the domain. */
  source: "preset" | "autoconfig" | "guess";
  /** The account's name in the app. */
  label: string;
  /** Said beside the password, when the provider needs something first (an app password, IMAP turned on). */
  hint?: string;
}

/** A service with its own setup in the app, so its addresses are not connected as a plain mailbox. */
export type Elsewhere = "google" | "microsoft" | "icloud";

export const IMAP_PORTS = [993, 143];
export const SMTP_PORTS = [465, 587, 25, 2525];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A DNS name with at least one dot, ending in a label that starts with a letter, so never an IP address. */
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const isEmail = (value: string) => EMAIL.test(value);
export const isHostname = (value: string) => HOSTNAME.test(value);

export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

const imap = (host: string, port = 993, tls: ImapTls = "tls"): ImapServer => ({ host, port, tls });
const smtp = (host: string, port = 465, security: SmtpSecurity = "ssl"): SmtpServer => ({ host, port, security });

export interface Preset {
  id: string;
  /** The account's name in the app. */
  label: string;
  /** Email domains the provider owns. */
  domains?: RegExp;
  /** MX hosts, for your own domain with its mail there. */
  mx?: RegExp;
  /** Name servers, for hosts whose customers' MX records are their own domain (mail.yourdomain). */
  ns?: RegExp;
  /** The servers for an address at this domain. via: the MX host that matched, if one did. */
  servers(domain: string, via?: string): { imap: ImapServer[]; smtp: SmtpServer[] };
  hint?: string;
}

/** iCloud Mail, including iCloud+ custom domains. The iCloud connector connects with exactly these. */
export const ICLOUD: Preset = {
  id: "icloud",
  label: "iCloud+ Mail",
  domains: /^(icloud|me|mac)\.com$/,
  mx: /(^|\.)icloud\.com$/,
  servers: () => ({ imap: [imap("imap.mail.me.com")], smtp: [smtp("smtp.mail.me.com", 587, "starttls")] }),
  hint: "iCloud needs an app-specific password, from account.apple.com.",
};

/** Hosted mail on your own domain at mail.yourdomain, as cPanel and most South African hosts set it up. */
export const CPANEL: Preset = {
  id: "cpanel",
  label: "Email",
  servers: (domain) => ({ imap: [imap(`mail.${domain}`)], smtp: [smtp(`mail.${domain}`), smtp(`mail.${domain}`, 587, "starttls")] }),
};

/** Zoho's data centre from a domain: zoho.com, zoho.eu, zoho.in, zoho.com.au or zoho.jp. */
const ZOHO_REGION = /(?:^|\.)zoho(?:mail)?\.(com\.au|com|eu|in|jp)$/;

// Checked against each provider's published settings. A preset lists its recommended servers first, and the
// other one the provider supports after, in case a network blocks a port.
export const PRESETS: Preset[] = [
  ICLOUD,
  {
    // help.yahoo.com/kb/SLN4075.html
    id: "yahoo",
    label: "Yahoo Mail",
    domains: /^(yahoo\.[a-z.]+|ymail\.com|rocketmail\.com)$/,
    mx: /(^|\.)yahoodns\.net$/,
    servers: () => ({ imap: [imap("imap.mail.yahoo.com")], smtp: [smtp("smtp.mail.yahoo.com"), smtp("smtp.mail.yahoo.com", 587, "starttls")] }),
    hint: "Yahoo needs an app password, made under Account Security in your Yahoo account.",
  },
  {
    // fastmail.help/hc/en-us/articles/1500000279921
    id: "fastmail",
    label: "Fastmail",
    domains: /^fastmail\.(com|fm)$/,
    mx: /(^|\.)messagingengine\.com$/,
    servers: () => ({ imap: [imap("imap.fastmail.com")], smtp: [smtp("smtp.fastmail.com"), smtp("smtp.fastmail.com", 587, "starttls")] }),
    hint: "Fastmail needs an app password, made under Settings, Privacy and Security.",
  },
  {
    // Zoho Mail's server details: personal addresses use imap and smtp, organisation domains imappro and smtppro.
    id: "zoho",
    label: "Zoho Mail",
    domains: /^(zoho|zohomail)\.(com|eu|in|com\.au|jp)$/,
    mx: ZOHO_REGION,
    servers: (domain, via) => {
      const region = (via ?? domain).match(ZOHO_REGION)?.[1] ?? "com";
      const own = !!via; // your own domain, found by its MX records
      const imapHosts = own ? [`imappro.zoho.${region}`, `imap.zoho.${region}`] : [`imap.zoho.${region}`];
      const smtpHosts = own ? [`smtppro.zoho.${region}`, `smtp.zoho.${region}`] : [`smtp.zoho.${region}`];
      return { imap: imapHosts.map((h) => imap(h)), smtp: smtpHosts.map((h) => smtp(h)) };
    },
    hint: "Turn on IMAP access in Zoho Mail's settings first. With two-factor sign-in, use an app password.",
  },
  {
    // support.gmx.com/pop-imap/imap/outlook.html. gmx.net and the German-speaking domains use the .net servers.
    id: "gmx",
    label: "GMX Mail",
    domains: /^gmx\.(com|us|co\.uk|fr|es|net|de|at|ch)$/,
    servers: (domain) => {
      const tld = /^gmx\.(net|de|at|ch)$/.test(domain) ? "net" : "com";
      return { imap: [imap(`imap.gmx.${tld}`)], smtp: [smtp(`mail.gmx.${tld}`, 587, "starttls"), smtp(`mail.gmx.${tld}`)] };
    },
    hint: "Turn on POP3 and IMAP access in GMX's settings first.",
  },
  {
    // help.afrihost.com: mail.yourdomain, IMAP 993 and SMTP 465 with SSL. Its customers' domains use its name servers.
    id: "afrihost",
    label: "Afrihost Mail",
    ns: /(^|\.)(dns1\.co\.za|dns2\.co\.za|otherdns\.com|otherdns\.net)$/,
    servers: CPANEL.servers,
  },
  {
    // xneelo.co.za/help-centre/email/email-settings: mail.yourdomain on 993, smtp.yourdomain on 465, both SSL.
    id: "xneelo",
    label: "xneelo Mail",
    mx: /(^|\.)host-h\.net$/,
    ns: /(^|\.)(host-h\.net|dns-h\.com)$/,
    servers: (domain) => ({ imap: [imap(`mail.${domain}`)], smtp: [smtp(`smtp.${domain}`), smtp(`mail.${domain}`), smtp(`smtp.${domain}`, 587, "starttls")] }),
    hint: "If xneelo's server is not found, use your hosting server's name from the xneelo Control Panel, like www34.cpt1.host-h.net.",
  },
  {
    // domains.co.za/knowledgebase/email/configure-an-email-account: mail.yourdomain, IMAP 993 and SMTP 465.
    id: "domains_co_za",
    label: "Domains.co.za Mail",
    mx: /(^|\.)tld-mx\.(com|net)$/,
    ns: /(^|\.)tld-ns\.(com|net)$/,
    servers: CPANEL.servers,
  },
];

const ELSEWHERE_DOMAINS: [RegExp, Elsewhere][] = [
  [/^(gmail|googlemail)\.com$/, "google"],
  [/^(outlook|hotmail|live|msn)\.[a-z.]+$/, "microsoft"],
  [/^(icloud|me|mac)\.com$/, "icloud"],
];
const ELSEWHERE_MX: [RegExp, Elsewhere][] = [
  [/(^|\.)(google|googlemail)\.com$/, "google"],
  [/(^|\.)(outlook\.com|office365\.us)$/, "microsoft"],
  [/(^|\.)icloud\.com$/, "icloud"],
];

/** What to tell someone connecting an address that has its own setup. */
export const ELSEWHERE_TEXT: Record<Elsewhere, string> = {
  google: "This address is on Google. Connect it with Google instead.",
  microsoft: "This address is on Microsoft. Connect it with Microsoft instead.",
  icloud: "This address is on iCloud. Connect it with iCloud instead.",
};

/** The service with its own setup for this address, by its domain or the domain's MX hosts. */
export function hostedElsewhere(domain: string, mx: string[] = []): Elsewhere | null {
  const byDomain = ELSEWHERE_DOMAINS.find(([pattern]) => pattern.test(domain))?.[1];
  if (byDomain) return byDomain;
  for (const host of mx) {
    const found = ELSEWHERE_MX.find(([pattern]) => pattern.test(host))?.[1];
    if (found) return found;
  }
  return null;
}

/** The preset for this address: by its domain, then by the first MX host or name server that matches one. */
export function matchPreset(domain: string, mx: string[] = [], ns: string[] = []): { preset: Preset; via?: string } | null {
  const byDomain = PRESETS.find((p) => p.domains?.test(domain));
  if (byDomain) return { preset: byDomain };
  for (const host of mx) {
    const preset = PRESETS.find((p) => p.mx?.test(host));
    if (preset) return { preset, via: host };
  }
  for (const host of ns) {
    const preset = PRESETS.find((p) => p.ns?.test(host));
    if (preset) return { preset };
  }
  return null;
}

export function fromPreset(email: string, preset: Preset, via?: string): Candidates {
  return { ...preset.servers(domainOf(email), via), username: email, source: "preset", label: preset.label, ...(preset.hint ? { hint: preset.hint } : {}) };
}

// ---------------------------------------------------------------------------------------------------------
// Mozilla's autoconfig format (wiki.mozilla.org/Thunderbird:Autoconfiguration:ConfigFileFormat)
// ---------------------------------------------------------------------------------------------------------

export const ISPDB = "https://autoconfig.thunderbird.net/v1.1/";

/** Where Thunderbird looks for a domain's settings, in its order: the domain's own files, then Mozilla's ISPDB. */
export function autoconfigUrls(domain: string): string[] {
  return [`https://autoconfig.${domain}/mail/config-v1.1.xml`, `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`, `${ISPDB}${domain}`];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]).trim();

function tags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => decode(m[1]));
}

/** Sign-in by password, the only kind this connects with. Servers that list no method are taken to use one. */
const PASSWORD_AUTH = new Set(["password-cleartext", "plain", "password-encrypted", "secure"]);

function fill(template: string, email: string): string {
  const at = email.lastIndexOf("@");
  return template
    .replace(/%EMAILADDRESS%/g, email)
    .replace(/%EMAILLOCALPART%/g, email.slice(0, at))
    .replace(/%EMAILDOMAIN%/g, email.slice(at + 1));
}

/**
 * The IMAP and SMTP servers in an autoconfig file, in the file's order (its preferred first), filled in for
 * this address. Servers without encryption, without password sign-in, or on unusual ports are left out.
 * Null when the file lists no usable IMAP or no usable SMTP server.
 */
export function parseAutoconfig(xml: string, email: string): { imap: ImapServer[]; smtp: SmtpServer[]; username: string } | null {
  const servers = (kind: "incomingServer" | "outgoingServer", type: string) =>
    [...xml.matchAll(new RegExp(`<${kind}\\b([^>]*)>([\\s\\S]*?)</${kind}>`, "gi"))]
      .filter((m) => new RegExp(`\\btype\\s*=\\s*["']${type}["']`, "i").test(m[1]))
      .map((m) => {
        const body = m[2];
        const auth = tags(body, "authentication").map((a) => a.toLowerCase());
        return {
          host: fill(tags(body, "hostname")[0] ?? "", email).toLowerCase(),
          port: Number(tags(body, "port")[0]),
          socket: (tags(body, "socketType")[0] ?? "").toUpperCase(),
          username: fill(tags(body, "username")[0] ?? "%EMAILADDRESS%", email),
          password: auth.length === 0 || auth.some((a) => PASSWORD_AUTH.has(a)),
        };
      })
      .filter((s) => s.password && isHostname(s.host) && (s.socket === "SSL" || s.socket === "STARTTLS"));

  const incoming = servers("incomingServer", "imap").map((s) => ({
    server: imap(s.host, s.port || (s.socket === "SSL" ? 993 : 143), s.socket === "SSL" ? "tls" : "starttls"),
    username: s.username,
  }));
  const outgoing = servers("outgoingServer", "smtp").map((s) => smtp(s.host, s.port || (s.socket === "SSL" ? 465 : 587), s.socket === "SSL" ? "ssl" : "starttls"));
  const imapList = incoming.filter((s) => IMAP_PORTS.includes(s.server.port));
  const smtpList = outgoing.filter((s) => SMTP_PORTS.includes(s.port));
  if (imapList.length === 0 || smtpList.length === 0) return null;
  return { imap: unique(imapList.map((s) => s.server)), smtp: unique(smtpList), username: imapList[0].username };
}

// ---------------------------------------------------------------------------------------------------------
// A guess from the domain and its MX records
// ---------------------------------------------------------------------------------------------------------

/** The domain a host belongs to: example.co.za for mail.example.co.za, tld-mx.com for mx1.tld-mx.com. */
export function baseDomain(host: string): string {
  const labels = host.split(".");
  // A country's second level (co.za, org.za, com.au, co.uk) takes one label more.
  const keep = labels.length >= 3 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

const MAX_GUESSES = 3;

/**
 * Where the servers probably are when nothing says: mail.yourdomain first (cPanel and most hosts), then
 * imap. and smtp.yourdomain, then the domain's first MX host, which on many hosts runs IMAP and SMTP too.
 */
export function guessServers(domain: string, mx: string[] = []): { imap: ImapServer[]; smtp: SmtpServer[] } {
  const exchange = mx.find((h) => isHostname(h));
  const imapHosts = unique([`mail.${domain}`, `imap.${domain}`, ...(exchange ? [exchange] : [])]);
  const smtpHosts = unique([`mail.${domain}`, `smtp.${domain}`, ...(exchange ? [exchange] : [])]);
  return {
    imap: imapHosts.slice(0, MAX_GUESSES).map((h) => imap(h)),
    // SSL on 465 and STARTTLS on 587 for the first host, which is usually right; SSL only for the others.
    smtp: [smtp(smtpHosts[0]), smtp(smtpHosts[0], 587, "starttls"), ...smtpHosts.slice(1, MAX_GUESSES).map((h) => smtp(h))],
  };
}

// ---------------------------------------------------------------------------------------------------------
// Working it all out
// ---------------------------------------------------------------------------------------------------------

/** DNS and HTTP, passed in. Each gives an empty list or null rather than throwing. */
export interface Lookups {
  /** MX hosts, best first, lowercase, without the trailing dot. */
  mx(domain: string): Promise<string[]>;
  /** Name servers, lowercase, without the trailing dot. */
  ns(domain: string): Promise<string[]>;
  /** The body at an https URL, or null when it is missing or could not be fetched. */
  text(url: string): Promise<string | null>;
}

/**
 * The servers for an address: a preset for its domain, its MX hosts or its name servers, then an autoconfig
 * file (the domain's own, then Mozilla's ISPDB for the domain and for its mail host's domain), then a guess.
 * An address on Google, Microsoft or iCloud is sent to that service's own setup instead.
 */
export async function discover(email: string, lookups: Lookups): Promise<Candidates | { elsewhere: Elsewhere }> {
  const domain = domainOf(email);
  const known = hostedElsewhere(domain);
  if (known) return { elsewhere: known };
  const byDomain = matchPreset(domain);
  if (byDomain) return fromPreset(email, byDomain.preset);

  const [mx, ns] = await Promise.all([lookups.mx(domain).catch(() => []), lookups.ns(domain).catch(() => [])]);
  const elsewhere = hostedElsewhere(domain, mx);
  if (elsewhere) return { elsewhere };
  const preset = matchPreset(domain, mx, ns);
  if (preset) return fromPreset(email, preset.preset, preset.via);

  const urls = autoconfigUrls(domain);
  const mailDomain = mx[0] && baseDomain(mx[0]);
  if (mailDomain && mailDomain !== domain) urls.push(`${ISPDB}${mailDomain}`);
  // Fetched together, so a slow host costs one timeout, then read in order.
  const files = await Promise.all(urls.map((url) => lookups.text(url).catch(() => null)));
  for (const xml of files) {
    const found = xml && parseAutoconfig(xml, email);
    if (found) return { ...found, source: "autoconfig", label: "Email" };
  }
  return { ...guessServers(domain, mx), username: email, source: "guess", label: "Email" };
}

/** Exactly these settings, to try alone: what someone typed under Show Server Settings. */
export function fromSettings(settings: ServerSettings, label = "Email"): Candidates {
  return { imap: [settings.imap], smtp: [settings.smtp], username: settings.username, source: "guess", label };
}

/** The first of each, to show under Show Server Settings. */
export function firstSettings(c: Candidates): ServerSettings {
  return { imap: c.imap[0], smtp: c.smtp[0], username: c.username };
}

/**
 * Settings typed in the app or the terminal, tidied, or the reason they cannot be used. Only encrypted
 * connections on the usual ports are accepted, so a password never crosses the network readable.
 */
export function readSettings(input: unknown): ServerSettings | { error: string } {
  const s = (input ?? {}) as { imap?: Partial<ImapServer>; smtp?: Partial<SmtpServer>; username?: unknown };
  const imapHost = String(s.imap?.host ?? "").trim().toLowerCase();
  const smtpHost = String(s.smtp?.host ?? "").trim().toLowerCase();
  const imapPort = Number(s.imap?.port);
  const smtpPort = Number(s.smtp?.port);
  const username = String(s.username ?? "").trim();
  if (!isHostname(imapHost)) return { error: "Enter the incoming (IMAP) server's name, like mail.yourdomain.co.za." };
  if (!isHostname(smtpHost)) return { error: "Enter the outgoing (SMTP) server's name, like mail.yourdomain.co.za." };
  if (!IMAP_PORTS.includes(imapPort)) return { error: "The IMAP port must be 993 (SSL) or 143 (STARTTLS)." };
  if (!SMTP_PORTS.includes(smtpPort)) return { error: "The SMTP port must be 465 (SSL), or 587, 25 or 2525 (STARTTLS)." };
  if (s.imap?.tls !== "tls" && s.imap?.tls !== "starttls") return { error: "Choose SSL or STARTTLS for the IMAP server." };
  if (s.smtp?.security !== "ssl" && s.smtp?.security !== "starttls") return { error: "Choose SSL or STARTTLS for the SMTP server." };
  if (!username || username.length > 320) return { error: "Enter the username, usually your full email address." };
  return { imap: imap(imapHost, imapPort, s.imap.tls), smtp: smtp(smtpHost, smtpPort, s.smtp.security), username };
}

function unique<T>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
