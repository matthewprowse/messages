import { lookup, resolveMx, resolveNs } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { Lookups } from "./index";

// DNS and HTTP for working out mail servers, on the server only. The servers come from what someone typed,
// so nothing here connects to a private address: a mailbox on 10.0.0.5 or localhost would let anyone probe
// the network the app or worker runs in.

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) PRIVATE.addSubnet(net, prefix, "ipv6");

/** Whether an IP address is on the public internet. IPv4 written inside IPv6 is judged as IPv4. */
export function isPublicAddress(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped) return isPublicAddress(mapped);
  const family = isIP(ip);
  if (family === 0 || /^::ffff:/i.test(ip)) return false; // a mapped IPv4 address in hex form is not judged
  return !PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * The address to connect to for a host, or null when it does not resolve or any address it resolves to is
 * private. Connecting to this address (with the host name for TLS) means a second lookup cannot swap it.
 */
export async function publicAddress(host: string): Promise<string | null> {
  try {
    const found = await lookup(host, { all: true, verbatim: true });
    if (found.length === 0 || !found.every((a) => isPublicAddress(a.address))) return null;
    return found[0].address;
  } catch {
    return null;
  }
}

const bare = (host: string) => host.toLowerCase().replace(/\.$/, "");

const MAX_BYTES = 64 * 1024; // autoconfig files are a few kilobytes
const MAX_REDIRECTS = 3;

/** An https body of at most MAX_BYTES, following a few redirects, each checked to be public, or null. */
async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  let next = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (next.protocol !== "https:" || !(await publicAddress(next.hostname))) return null;
    const response = await fetch(next, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/xml, text/xml" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return null;
      next = new URL(location, next);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
    return Buffer.concat(parts).toString("utf8");
  }
  return null;
}

/** Real DNS and HTTPS, each step giving up after timeoutMs. */
export function nodeLookups(timeoutMs = 5_000): Lookups {
  const timed = <T>(work: Promise<T>, fallback: T) =>
    Promise.race([work.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs).unref())]);
  return {
    mx: (domain) => timed(resolveMx(domain).then((r) => r.sort((a, b) => a.priority - b.priority).map((x) => bare(x.exchange)).filter(Boolean)), []),
    ns: (domain) => timed(resolveNs(domain).then((r) => r.map(bare)), []),
    text: (url) => timed(fetchText(url, timeoutMs), null),
  };
}
