// Reads the receiving server's SPF, DKIM and DMARC verdicts from an email's Authentication-Results header, and decides
// whether an email with your own address in From is really yours. Pure: no I/O. normalize-email.ts reads the header;
// store-email.ts stores the verdicts as messages.provider_meta.auth, which the AI worker reads for its phishing checks.

/**
 * The verdicts as lowercase code words ("pass", "fail", "softfail", ...), never any other header text. A key is left
 * out when the header does not give it.
 */
export interface EmailAuth {
  spf?: string;
  dkim?: string;
  dmarc?: string;
}

// The result words RFC 8601 and the big providers use. Anything else is dropped, so nothing a sender wrote is stored.
const VERDICTS = new Set(["pass", "fail", "softfail", "neutral", "none", "temperror", "permerror", "policy", "hardfail", "bestguesspass"]);
const METHODS = ["spf", "dkim", "dmarc"] as const;
const HEADER_MAX_CHARS = 8_192;

/**
 * The verdicts of the topmost Authentication-Results header, or null when there is none or it names none. Servers add
 * theirs on top, so the topmost is the last receiving server's own; a copy a sender wrote into the message sits below
 * it. A server that adds none leaves a sender's copy on top, so for such mail this is a hint, not proof.
 * @param headers the message's Authentication-Results values, top first, unfolded.
 */
export function parseAuthResults(headers: readonly string[]): EmailAuth | null {
  const header = headers[0];
  if (!header) return null;
  // Comments ("(google.com: domain of ... designates ...)") can hold anything, ";" included: dropped first.
  const plain = header.slice(0, HEADER_MAX_CHARS).replace(/\([^()]*\)/g, " ").replace(/\([^()]*\)/g, " ");
  const found: { [K in (typeof METHODS)[number]]?: string[] } = {};
  for (const part of plain.split(";")) {
    const m = /^\s*(spf|dkim|dmarc)\s*=\s*([a-z]+)/i.exec(part);
    if (!m) continue;
    const verdict = m[2].toLowerCase();
    if (!VERDICTS.has(verdict)) continue;
    (found[m[1].toLowerCase() as (typeof METHODS)[number]] ??= []).push(verdict);
  }
  const out: EmailAuth = {};
  for (const method of METHODS) {
    const list = found[method];
    if (!list) continue;
    // A message can carry several DKIM signatures: one that verified is enough.
    out[method] = method === "dkim" && list.includes("pass") ? "pass" : list[0];
  }
  return Object.keys(out).length > 0 ? out : null;
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
