import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// A company's icon, fetched from its own website: the icon its home page names (preferring the large
// "apple-touch-icon" phones use), else the conventional /apple-touch-icon.png, else /favicon.ico. The
// domains come from the senders of email, so anyone can choose them: only HTTPS, only public addresses
// (never this Mac, the local network or cloud metadata), redirects checked one by one, small sizes and
// short timeouts. Nothing is sent but a plain request.

const PAGE_BYTES = 512 * 1024;
const ICON_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/** True for an address on the public internet. IPv4 written inside IPv6 is checked as IPv4. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  const ip = mapped ?? address;
  const family = isIP(ip);
  if (family === 0) return false;
  return !PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

async function publicHost(url: URL): Promise<boolean> {
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) return false;
  if (isIP(url.hostname)) return isPublicAddress(url.hostname);
  const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
  return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
}

/** Fetches a public HTTPS address, following up to three redirects that are also public. Null on anything else. */
async function safeGet(start: string, maxBytes: number): Promise<{ bytes: Buffer; url: URL; type: string } | null> {
  let url: URL;
  try {
    url = new URL(start);
  } catch {
    return null;
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await publicHost(url))) return null;
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/html,image/*;q=0.9" } }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => undefined);
      const next = res.headers.get("location");
      if (!next) return null;
      url = new URL(next, url);
      continue;
    }
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body.cancel().catch(() => undefined);
      return null;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) return null;
      chunks.push(Buffer.from(chunk));
    }
    return { bytes: Buffer.concat(chunks), url, type: res.headers.get("content-type") ?? "" };
  }
  return null;
}

/** Icons a home page names, best first: apple-touch-icon, then the largest other icon. SVG is skipped. */
export function iconCandidates(html: string, base: URL): string[] {
  const found: { href: string; score: number }[] = [];
  for (const tag of html.slice(0, PAGE_BYTES).match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1].toLowerCase() ?? "";
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href || !/(^|\s)(icon|apple-touch-icon(-precomposed)?)(\s|$)/.test(rel)) continue;
    if (/\.svg(\?|$)/i.test(href) || /image\/svg/i.test(tag)) continue;
    const size = Number(/\bsizes\s*=\s*["']?(\d+)x\d+/i.exec(tag)?.[1] ?? 0);
    const score = (rel.includes("apple-touch-icon") ? 1_000 : 0) + Math.min(size, 512);
    try {
      found.push({ href: new URL(href.replace(/&amp;/g, "&"), base).href, score });
    } catch {
      // an unusable address: skip it
    }
  }
  return [...new Map(found.sort((a, b) => b.score - a.score).map((f) => [f.href, f])).keys()];
}

/** What a photo looks like from its first bytes. Anything else is not stored. Kept here, free of the database, so it can be unit tested. */
export function imageType(bytes: Buffer): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (bytes.length > 6 && bytes.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  return null;
}

/** The type of an icon from its first bytes: the photo types, plus ICO. Anything else is not used. */
export function iconType(bytes: Buffer): string | null {
  const isIco = bytes.length > 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
  return isIco ? "image/x-icon" : imageType(bytes);
}

/** The company's icon and its type, or null when its site offers none we can use. */
export async function siteIcon(domain: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  const page = await safeGet(`https://${domain}/`, PAGE_BYTES);
  const base = page?.url ?? new URL(`https://${domain}/`);
  const named = page && /html/i.test(page.type) ? iconCandidates(page.bytes.toString("utf8"), base) : [];
  for (const candidate of [...named, new URL("/apple-touch-icon.png", base).href, new URL("/favicon.ico", base).href]) {
    const icon = await safeGet(candidate, ICON_BYTES);
    const type = icon && iconType(icon.bytes);
    if (icon && type && icon.bytes.length > 100) return { bytes: icon.bytes, type };
  }
  return null;
}
