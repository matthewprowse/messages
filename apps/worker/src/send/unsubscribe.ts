// Unsubscribing acts only on the sender's List-Unsubscribe header. A link in the email body is only
// shown to you, never followed: body links can confirm your address to spammers or lead to phishing pages.

import { request } from "node:https";
import { isIP } from "node:net";
import { isPublicAddress, publicAddress } from "@messages/mail-servers/net";
import { isEmailAddress } from "./from-address";

export interface UnsubscribeOptions {
  https: string | null;
  mailto: { to: string; subject: string; body: string } | null;
}

/**
 * Decodes RFC 2047 encoded words ("=?us-ascii?Q?...?=" or "=?utf-8?B?...?="), which some senders
 * use even for header values that are plain URLs. Whitespace between encoded words is dropped.
 */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, charset: string, encoding: string, text: string) => {
      const bytes =
        encoding.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
      try {
        return new TextDecoder(charset.toLowerCase() === "us-ascii" ? "utf-8" : charset).decode(bytes);
      } catch {
        return bytes.toString("utf8");
      }
    });
}

/** The subject and body of every unsubscribe email, whatever the sender's header asks for. */
export const UNSUBSCRIBE_SUBJECT = "Unsubscribe";
export const UNSUBSCRIBE_BODY = "Unsubscribe";

/** The one address of a mailto link, or null when it is not exactly one plausible address. Its case is kept: some lists put a token in it. */
function mailtoAddress(raw: string): string | null {
  let to: string;
  try {
    to = decodeURIComponent(raw).trim();
  } catch {
    return null; // a broken %-escape
  }
  return isEmailAddress(to) ? to : null;
}

/** Reads "<https://...>, <mailto:...>" into the options a sender offers. */
export function parseListUnsubscribe(header: string | null): UnsubscribeOptions {
  const out: UnsubscribeOptions = { https: null, mailto: null };
  if (!header) return out;
  header = decodeEncodedWords(header);
  for (const match of header.matchAll(/<([^>]+)>/g)) {
    const value = match[1].trim();
    if (!out.https && /^https:\/\//i.test(value)) {
      try {
        out.https = new URL(value).toString();
      } catch {
        // not a usable URL
      }
    } else if (!out.mailto && /^mailto:/i.test(value)) {
      // The header is not authenticated, so only the address is taken from it: exactly one, and the
      // subject and body are always ours. A sender-chosen subject or body would let a forged header
      // write whatever it likes from your address.
      const to = mailtoAddress(value.slice(7).split("?")[0]);
      if (to) out.mailto = { to, subject: UNSUBSCRIBE_SUBJECT, body: UNSUBSCRIBE_BODY };
    }
  }
  return out;
}

// The body is the sender's text, decrypted, and this runs on the worker's one thread: only its start and end are
// read (where footers are), and the scan is linear however the text is shaped.
const BODY_SCAN_CHARS = 50_000; // from each end
const URL_MAX_CHARS = 2_048;
const UNSUBSCRIBE = /unsubscribe/gi;
const URL_START = /https:\/\/|www\./i;
const NOT_URL = /[\s<>"\]]/;
const WORD = "unsubscribe".length;
const NEAR_CHARS = 40; // how far after the word "unsubscribe" its link may start, on the same line

/**
 * For senders with no List-Unsubscribe header: the unsubscribe link from the email's text, if it has
 * one. It is only ever shown to you to open yourself, never followed by the worker. The first of: a link
 * with "unsubscribe" in it, or a link starting up to 40 characters after the word on the same line.
 */
export function bodyUnsubscribeLink(text: string | null): string | null {
  if (!text) return null;
  if (text.length > BODY_SCAN_CHARS * 2) text = `${text.slice(0, BODY_SCAN_CHARS)}\n${text.slice(-BODY_SCAN_CHARS)}`;
  const raw = findUnsubscribeUrl(text);
  if (!raw || raw.length > URL_MAX_CHARS) return null;
  try {
    const url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Walks the occurrences of "unsubscribe" once, left to right. Each run of link characters is measured once,
 * however many occurrences it holds, so the work is linear in the text's length.
 */
function findUnsubscribeUrl(text: string): string | null {
  let tokenStart = -1;
  let tokenEnd = -1;
  let urlInToken = -1; // where the token's first https:// or www. starts, or -1
  for (const match of text.matchAll(UNSUBSCRIBE)) {
    const at = match.index;
    if (at >= tokenEnd) {
      tokenStart = at;
      while (tokenStart > 0 && !NOT_URL.test(text[tokenStart - 1])) tokenStart--;
      tokenEnd = runEnd(text, at);
      const found = text.slice(tokenStart, tokenEnd).search(URL_START);
      urlInToken = found < 0 ? -1 : tokenStart + found;
    }
    // A link with the word in it, starting before the word.
    if (urlInToken >= 0 && urlInToken < at) return text.slice(urlInToken, tokenEnd);
    // A link shortly after the word, on the same line.
    const after = at + WORD;
    const window = text.slice(after, after + NEAR_CHARS + "https://".length).split("\n")[0];
    const near = window.search(URL_START);
    if (near >= 0 && near <= NEAR_CHARS) return text.slice(after + near, runEnd(text, after + near));
  }
  return null;
}

/** Where the run of link characters starting at `from` ends. */
function runEnd(text: string, from: number): number {
  let end = from;
  while (end < text.length && !NOT_URL.test(text[end])) end++;
  return end;
}

/** True for loopback, private, link-local, NAT64, 6to4 and other addresses that are not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  return !isPublicAddress(ip);
}

/** One POST to a pinned address, with the host name for TLS and the Host header. No redirects are followed. */
function postPinned(target: URL, address: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: address,
        port: target.port || 443,
        servername: isIP(target.hostname.replace(/^\[|\]$/g, "")) ? undefined : target.hostname,
        method: "POST",
        path: `${target.pathname}${target.search}`,
        headers: {
          host: target.host,
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
          "user-agent": "Messages unsubscribe",
        },
        timeout: 15_000,
      },
      (res) => {
        res.destroy(); // the body is never read
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

export interface UnsubscribeDeps {
  /** The public address to connect to for a host, or null. */
  resolve?: (host: string) => Promise<string | null>;
  post?: (target: URL, address: string, body: string) => Promise<number>;
}

/**
 * RFC 8058 one-click unsubscribe: a POST of "List-Unsubscribe=One-Click" to the sender's https URL.
 * The URL comes from an email, so it must resolve to a public address, the connection is made to that exact
 * address (a second DNS answer cannot swap it), and redirects are not followed.
 */
export async function oneClickUnsubscribe(url: string, deps: UnsubscribeDeps = {}): Promise<{ ok: boolean; status?: number; reason?: string }> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, reason: "bad url" };
  }
  if (target.protocol !== "https:") return { ok: false, reason: "not https" };
  const host = target.hostname.replace(/^\[|\]$/g, "");
  const address = isIP(host) ? (isPublicAddress(host) ? host : null) : await (deps.resolve ?? publicAddress)(host);
  if (!address) return { ok: false, reason: "private or unknown address" };

  let status: number;
  try {
    status = await (deps.post ?? postPinned)(target, address, "List-Unsubscribe=One-Click");
  } catch {
    return { ok: false, reason: "request failed" };
  }
  // Some senders answer with a redirect to a "you're unsubscribed" page, which still means it worked.
  return { ok: status >= 200 && status < 400, status };
}
