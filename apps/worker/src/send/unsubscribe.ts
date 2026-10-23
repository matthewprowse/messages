import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Unsubscribing acts only on the sender's List-Unsubscribe header. A link in the email body is only
// shown to you, never followed: body links can confirm your address to spammers or lead to phishing pages.

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
      const [address, query = ""] = value.slice(7).split("?");
      const params = new URLSearchParams(query);
      const to = decodeURIComponent(address).trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        out.mailto = { to, subject: params.get("subject") || "unsubscribe", body: params.get("body") || "unsubscribe" };
      }
    }
  }
  return out;
}

/**
 * For senders with no List-Unsubscribe header: the unsubscribe link from the email's text, if it has
 * one. It is only ever shown to you to open yourself, never followed by the worker.
 */
export function bodyUnsubscribeLink(text: string | null): string | null {
  if (!text) return null;
  const pattern = /unsubscribe[^\n]{0,40}?((?:https:\/\/|www\.)[^\s<>"\]]+)|((?:https:\/\/|www\.)[^\s<>"\]]*unsubscribe[^\s<>"\]]*)/i;
  const match = text.match(pattern);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("www.") ? `https://${raw}` : raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** True for loopback, private, link-local and other addresses that are not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") ||
    v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

/**
 * RFC 8058 one-click unsubscribe: a POST of "List-Unsubscribe=One-Click" to the sender's https URL.
 * The URL comes from an email, so it must resolve to a public address and redirects are not followed.
 */
export async function oneClickUnsubscribe(url: string): Promise<{ ok: boolean; status?: number; reason?: string }> {
  const target = new URL(url);
  if (target.protocol !== "https:") return { ok: false, reason: "not https" };
  const host = target.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) return { ok: false, reason: "unknown host" };
  if (addresses.some((a) => isPrivateAddress(a.address))) return { ok: false, reason: "private address" };

  const response = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Messages unsubscribe" },
    body: "List-Unsubscribe=One-Click",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel().catch(() => undefined);
  // Some senders answer with a redirect to a "you're unsubscribed" page, which still means it worked.
  return { ok: response.status >= 200 && response.status < 400, status: response.status };
}
