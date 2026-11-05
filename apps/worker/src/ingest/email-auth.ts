// Reads the receiving server's SPF, DKIM and DMARC verdicts from an email's Authentication-Results header, decides
// whether that header is the provider's own, checks a From display name against the From address, and decides whether
// an email with your own address in From is really yours. Pure: no I/O. normalize-email.ts reads the headers;
// store-email.ts stores the results as messages.provider_meta (auth, name_mismatch), which the AI worker reads for its
// phishing checks and the unsubscribe flow reads to pick an email the sender's domain vouched for.

/**
 * The verdicts as lowercase code words ("pass", "fail", "softfail", ...), never any other header text. A key is left
 * out when the header does not give it. dkim_domain is the signing domain (header.d) of a DKIM signature that passed,
 * so a pass can be checked against the From domain: a signature by any domain is not the sender's word.
 */
export interface EmailAuth {
  spf?: string;
  dkim?: string;
  dmarc?: string;
  dkim_domain?: string;
}

// The result words RFC 8601 and the big providers use. Anything else is dropped, so nothing a sender wrote is stored.
const VERDICTS = new Set(["pass", "fail", "softfail", "neutral", "none", "temperror", "permerror", "policy", "hardfail", "bestguesspass"]);
const METHODS = ["spf", "dkim", "dmarc"] as const;
const HEADER_MAX_CHARS = 8_192;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Whether the server named in an Authentication-Results header (its authserv-id; null when it names none) is trusted. */
export type AuthservTrust = (authservId: string | null) => boolean;

/**
 * The verdicts of the topmost Authentication-Results header, or null when there is none, it names none, or `trust`
 * says the server it names is not the account's own provider. Servers add theirs on top, so the topmost is the last
 * receiving server's own; a copy a sender wrote into the message sits below it. A server that adds none leaves a
 * sender's copy on top, which is why the header's authserv-id is checked against the provider (authservTrust): a
 * forged "dmarc=pass" from a server that is not yours counts for nothing.
 * @param headers the message's Authentication-Results values, top first, unfolded.
 */
export function parseAuthResults(headers: readonly string[], trust?: AuthservTrust): EmailAuth | null {
  const header = headers[0];
  if (!header) return null;
  // Comments ("(google.com: domain of ... designates ...)") can hold anything, ";" included: dropped first.
  const plain = header.slice(0, HEADER_MAX_CHARS).replace(/\([^()]*\)/g, " ").replace(/\([^()]*\)/g, " ");
  const parts = plain.split(";");
  if (trust && !trust(authservIdOf(parts[0] ?? ""))) return null;
  const found: { [K in (typeof METHODS)[number]]?: string[] } = {};
  let dkimDomain: string | undefined;
  for (const part of parts) {
    const m = /^\s*(spf|dkim|dmarc)\s*=\s*([a-z]+)/i.exec(part);
    if (!m) continue;
    const verdict = m[2].toLowerCase();
    if (!VERDICTS.has(verdict)) continue;
    const method = m[1].toLowerCase() as (typeof METHODS)[number];
    (found[method] ??= []).push(verdict);
    if (method === "dkim" && verdict === "pass" && !dkimDomain) {
      const d = /\bheader\.d\s*=\s*([a-z0-9.-]+)/i.exec(part)?.[1] ?? /\bheader\.i\s*=\s*@?[^@\s]*@([a-z0-9.-]+)/i.exec(part)?.[1];
      if (d && DOMAIN.test(d)) dkimDomain = d.toLowerCase();
    }
  }
  const out: EmailAuth = {};
  for (const method of METHODS) {
    const list = found[method];
    if (!list) continue;
    // A message can carry several DKIM signatures: one that verified is enough.
    out[method] = method === "dkim" && list.includes("pass") ? "pass" : list[0];
  }
  if (out.dkim === "pass" && dkimDomain) out.dkim_domain = dkimDomain;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The authserv-id of a header's first segment: "mx.google.com" in "mx.google.com; spf=pass ...", null when the segment
 * is already a result ("spf=pass ...", as Microsoft writes it) or is not a host name.
 */
export function authservIdOf(first: string): string | null {
  const token = first.trim().split(/\s+/)[0] ?? "";
  if (!token || token.includes("=")) return null;
  return DOMAIN.test(token) ? token.toLowerCase() : null;
}

/**
 * Which Authentication-Results servers an account of this provider trusts. Gmail signs as mx.google.com; Microsoft
 * writes its results with no authserv-id and removes a sender's copies on the way in; iCloud signs as its own hosts; a
 * generic IMAP server is trusted when the header names a host in the mail host's own organisation (so a server that
 * adds none, leaving a sender's copy on top, vouches for nothing).
 */
export function authservTrust(provider: string, mailHost?: string | null): AuthservTrust {
  switch (provider) {
    case "gmail":
      return (id) => id !== null && (id === "google.com" || id.endsWith(".google.com"));
    case "outlook":
      return (id) => id === null || /(^|\.)(protection\.outlook\.com|office365\.com|microsoft\.com)$/.test(id);
    case "icloud":
      return (id) => id !== null && /(^|\.)(icloud\.com|apple\.com|me\.com|mac\.com)$/.test(id);
    default: {
      const own = mailHost ? organisationOf(mailHost) : null;
      return (id) => id !== null && own !== null && organisationOf(id) === own;
    }
  }
}

// Second-level labels under a country code, so "mail.acme.co.za" is the organisation "acme.co.za", as "acme.com" is.
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "nom", "web"]);

/** The domain a host is registered under: "acme.co.za" for mail.acme.co.za, "acme.com" for acme.com. Null for none. */
export function organisationOf(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.+$/, "").split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? null;
  const take = labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** The name an organisation goes by: "acme" for acme.com, mail.acme.co.za and acme.co.uk. */
export function brandOf(host: string): string {
  return organisationOf(host)?.split(".")[0] ?? "";
}

/** Whether a DKIM pass by `signingDomain` is the From domain's own word: the same organisation. */
export function dkimAligned(signingDomain: string | undefined, fromDomain: string | null | undefined): boolean {
  return !!signingDomain && !!fromDomain && organisationOf(signingDomain) === organisationOf(fromDomain);
}

const EMAIL_IN = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
// A domain shown in a display name ("PayPal.com Support"). Only common endings count, so "St.John" or "J.Smith" is a name.
const TLDS = "com|net|org|info|biz|io|co|ai|app|dev|me|online|site|xyz|shop|store|email|support|live|africa|za|uk|us|eu|de|fr|nl|au|ca|in|ng|ke";
const DOMAIN_IN = new RegExp(`\\b((?:[a-z0-9-]+\\.)+(?:${TLDS}))\\b`, "gi");

/**
 * True when a From display name carries an email address or a domain of another brand than the From address's own
 * ("PayPal Support <x@evil.biz>", "billing@acme.com <x@gmail.com>"): the mail claims to be from somewhere it is not.
 * Checked here, at ingest, from the message's own From line: the contact may be stored under the person's real name,
 * which would hide it from a check on the stored name (apps/ai/ai/triage_extras.py header_suspicion).
 */
export function nameMismatch(displayName: string | null | undefined, fromAddress: string | null | undefined): boolean {
  const at = fromAddress?.lastIndexOf("@") ?? -1;
  if (!displayName || at < 0) return false;
  const mine = brandOf(fromAddress!.slice(at + 1));
  if (!mine) return false;
  const shown = displayName.slice(0, 512);
  for (const m of shown.matchAll(EMAIL_IN)) if (brandOf(m[1]) !== mine) return true;
  for (const m of shown.replace(EMAIL_IN, " ").matchAll(DOMAIN_IN)) if (brandOf(m[1]) !== mine) return true;
  return false;
}

/**
 * Whether an email is yours (outbound, stored read) rather than to you. Anything in a sent folder is. In the inbox,
 * anyone can write your address in From, so a message from your own address counts as yours only when DMARC passed,
 * meaning your provider vouched that it came from your address's domain. Elsewhere (an archive folder) your own copies
 * of what you sent carry no such header, so the From address decides, as before.
 */
export function isOwnMail(role: string, from: string | null, selfAddresses: ReadonlySet<string>, auth: EmailAuth | null | undefined): boolean {
  if (role === "sent") return true;
  if (!from || !selfAddresses.has(from)) return false;
  return role !== "inbox" || auth?.dmarc === "pass";
}
