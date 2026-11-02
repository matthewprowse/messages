// DNS and HTTP for working out mail servers, on the server only. The servers come from what someone typed,
// so nothing here connects to a private address: a mailbox on 10.0.0.5 or localhost would let anyone probe
// the network the app or worker runs in.

import { lookup, Resolver as DnsResolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type { LookupAddress } from "node:dns";
import type { Lookups } from "./index";

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) PRIVATE.addSubnet(net, prefix, "ipv6");

/**
 * Whether an IP address is on the public internet. IPv4 written inside IPv6 (::ffff:1.2.3.4 or the hex form
 * ::ffff:102:304) is judged as IPv4. NAT64 (64:ff9b::/96), 6to4 (2002::/16), Teredo (2001::/32) and the old
 * IPv4-compatible form (::/96) are refused outright, since they can carry a private IPv4 address.
 */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  if (family === 6) {
    // The URL parser writes any IPv6 form the same way, so ::ffff:7f00:1 and ::ffff:127.0.0.1 look alike.
    let canonical: string;
    try {
      canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1).toLowerCase();
    } catch {
      return false;
    }
    const hex = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (canonical.startsWith("::ffff:")) return false;
    return !PRIVATE.check(canonical, "ipv6");
  }
  return !PRIVATE.check(ip, "ipv4");
}

/**
 * The address to connect to for a host, or null when it does not resolve or any address it resolves to is
 * private. Connecting to this address (with the host name for TLS) means a second lookup cannot swap it.
 */
export async function publicAddress(host: string, timeoutMs = 5_000): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    // getaddrinfo cannot be aborted, so a slow lookup is abandoned (its result is ignored) rather than cancelled.
    const found = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("lookup timeout")), timeoutMs); }),
    ]);
    if (found.length === 0 || !found.every((a) => isPublicAddress(a.address))) return null;
    return found[0].address;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const bare = (host: string) => host.toLowerCase().replace(/\.$/, "");

/** Resolves a host name to all its addresses. Injectable so tests need no network. */
export type Resolver = (host: string) => Promise<LookupAddress[]>;
const systemResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/**
 * A socket lookup that only ever answers with a vetted public address: the address connected to is the one
 * checked here, so a second lookup (DNS rebinding) cannot swap in a private one. Errors when any address the
 * host resolves to is private.
 */
export function vettedLookup(resolve: Resolver = systemResolver) {
  return (host: string, options: { all?: boolean }, callback: (err: Error | null, address?: string | LookupAddress[], family?: number) => void) => {
    resolve(host).then(
      (found) => {
        if (found.length === 0 || !found.every((a) => isPublicAddress(a.address))) return callback(Object.assign(new Error("not a public address"), { code: "ENOTPUBLIC" }));
        if (options?.all) return callback(null, found);
        callback(null, found[0].address, found[0].family);
      },
      (err) => callback(err instanceof Error ? err : new Error("lookup failed")),
    );
  };
}

export interface PinnedResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** The body, read as it arrives. */
  body: AsyncIterable<Buffer>;
  /** Stops the download. */
  destroy(): void;
}

/**
 * One HTTPS GET on port 443 whose connection goes only to a vetted public address (see vettedLookup). Does not
 * follow redirects: the caller vets each hop by calling this again. Rejects on a bad address, port or timeout.
 */
export function pinnedGet(url: URL, timeoutMs: number, headers: Record<string, string> = {}, resolve?: Resolver): Promise<PinnedResponse> {
  return new Promise((done, fail) => {
    if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) return fail(new Error("not an allowed address"));
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !isPublicAddress(host)) return fail(new Error("not a public address"));
    const req = httpsRequest(
      { protocol: "https:", hostname: host, port: 443, path: `${url.pathname}${url.search}`, method: "GET", headers, lookup: vettedLookup(resolve) as never, timeout: timeoutMs, servername: isIP(host) ? undefined : host },
      (res) => done({ status: res.statusCode ?? 0, headers: res.headers, body: res as AsyncIterable<Buffer>, destroy: () => res.destroy() }),
    );
    const timer = setTimeout(() => req.destroy(new Error("timeout")), timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", fail);
    req.end();
  });
}

const MAX_BYTES = 64 * 1024; // autoconfig files are a few kilobytes
const MAX_REDIRECTS = 3;

/** An https body of at most MAX_BYTES, following a few redirects, each connected to a vetted public address, or null. */
export async function fetchText(url: string, timeoutMs: number, resolve?: Resolver): Promise<string | null> {
  try {
    let next = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await pinnedGet(next, timeoutMs, { accept: "application/xml, text/xml" }, resolve);
      if (response.status >= 300 && response.status < 400) {
        response.destroy();
        const location = response.headers.location;
        if (typeof location !== "string" || !location) return null;
        next = new URL(location, next);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        response.destroy();
        return null;
      }
      const parts: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BYTES) {
          response.destroy();
          return null;
        }
        parts.push(chunk);
      }
      return Buffer.concat(parts).toString("utf8");
    }
  } catch {
    // an unreachable, private or slow host: no file
  }
  return null;
}

/** Real DNS and HTTPS, each step giving up after timeoutMs. */
export function nodeLookups(timeoutMs = 5_000): Lookups {
  // A fresh resolver per query so a timeout can cancel it for real (c-ares abandons the socket and the query),
  // instead of leaving it running behind the race. tries: 1 keeps the resolver's own retries inside timeoutMs.
  const dns = <T>(query: (r: DnsResolver) => Promise<T>, fallback: T) => {
    const resolver = new DnsResolver({ timeout: timeoutMs, tries: 1 });
    const timer = setTimeout(() => resolver.cancel(), timeoutMs).unref();
    return query(resolver).catch(() => fallback).finally(() => clearTimeout(timer));
  };
  return {
    mx: (domain) => dns((r) => r.resolveMx(domain).then((m) => m.sort((a, b) => a.priority - b.priority).map((x) => bare(x.exchange)).filter(Boolean)), []),
    ns: (domain) => dns((r) => r.resolveNs(domain).then((n) => n.map(bare)), []),
    // fetchText ends by itself: pinnedGet destroys the request at timeoutMs.
    text: (url) => fetchText(url, timeoutMs),
  };
}
