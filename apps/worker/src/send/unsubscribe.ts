// Unsubscribing acts only on the sender's List-Unsubscribe header. A link in the email body is only
// shown to you, never followed: body links can confirm your address to spammers or lead to phishing pages.

import { request } from "node:https";
import { isIP } from "node:net";
import { isPublicAddress, publicAddress } from "@messages/mail-servers/net";

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
