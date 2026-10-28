// A company's logo, fetched from its own website: every icon its home page and web app manifest name
// (the large "apple-touch-icon" phones use, manifest icons, SVG icons, ordinary favicons), plus the
// conventional /apple-touch-icon.png and /favicon.ico. Each is framed by logo-image.ts and the sharpest
// wins; icons too small to look sharp are never used. When the site offers nothing sharp enough, Google's
// public favicon service is asked for the same domain (only the domain is sent, never an address or any
// mail). The domains come from the senders of email, so anyone can choose them: only HTTPS, only public
// addresses (never this Mac, the local network or cloud metadata), redirects checked one by one, small
// sizes and short timeouts. Nothing is sent but a plain request.

import { isPublicAddress, pinnedGet, type PinnedResponse, type Resolver } from "@messages/mail-servers/net";

export { isPublicAddress };
import { frameLogo, type Logo } from "./logo-image";

const PAGE_BYTES = 1024 * 1024;
const ICON_BYTES = 1024 * 1024;
const MANIFEST_BYTES = 64 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 4;
/** A logo this sharp (see Logo.quality) is good enough: no more icons are fetched for it. */
const GOOD = 120;
/** A logo less sharp than this is not used at all: a plain avatar is better than a blurred one. 28 is a 48px favicon's mark, drawn at about 1.5 times its size on a 2x screen; a 16px favicon is far below. */
const MIN_QUALITY = 28;
/** At most this many icons are fetched from one site. */
const MAX_TRIES = 8;

/**
 * Fetches a public HTTPS address, following up to four redirects that are also public. Null on anything
 * else. A body over maxBytes is refused, or with `truncate` cut short (a home page's icons are in its head).
 * `headers` are added to the request (a User-Agent some services ask for). Every connection goes to an
 * address that was checked as public at the moment of connecting (pinnedGet), so a second DNS answer cannot
 * point a request at the local network. `resolve` is for tests.
 */
export async function safeGet(start: string, maxBytes: number, truncate = false, headers: Record<string, string> = {}, resolve?: Resolver): Promise<{ bytes: Buffer; url: URL; type: string } | null> {
  let url: URL;
  try {
    url = new URL(start);
  } catch {
    return null;
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: PinnedResponse;
    try {
      res = await pinnedGet(url, TIMEOUT_MS, { accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8", ...headers }, resolve);
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      res.destroy();
      const next = res.headers.location;
      if (typeof next !== "string" || !next) return null;
      try {
        url = new URL(next, url);
      } catch {
        return null;
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      res.destroy();
      return null;
    }
    const declared = Number(res.headers["content-length"] ?? 0);
    if (declared > maxBytes && !truncate) {
      res.destroy();
      return null;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of res.body) {
        chunks.push(Buffer.from(chunk));
        size += chunk.length;
        if (size > maxBytes) {
          res.destroy();
          if (!truncate) return null;
          break; // the rest of the download is dropped
        }
      }
    } catch {
      if (!truncate || size === 0) return null;
    }
    const type = res.headers["content-type"];
    return { bytes: Buffer.concat(chunks).subarray(0, maxBytes), url, type: typeof type === "string" ? type : "" };
  }
  return null;
}

/**
 * Where an icon was named, best first when two are as sharp: phones' icons, then manifest, SVG, the rest.
 * "logo" is a logo image on the page itself, offered only when asked for (see candidatesFor).
 */
export type IconKind = "touch" | "manifest" | "svg" | "icon" | "logo" | "guess" | "google";
const KIND_ORDER: IconKind[] = ["touch", "manifest", "svg", "icon", "logo", "guess", "google"];

export interface IconCandidate {
  href: string;
  kind: IconKind;
  /** The size it says it is (its larger side), or 0 when it does not say. */
  size: number;
}

/** The largest size a sizes attribute lists ("16x16 32x32", "any" for SVG), or 0. */
function declaredSize(sizes: string | undefined): number {
  if (!sizes) return 0;
  if (/\bany\b/i.test(sizes)) return 512;
  return Math.max(0, ...[...sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)].map((m) => Math.max(Number(m[1]), Number(m[2]))));
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined);

/** Icons a home page names, best first, and its web app manifest's address. Icons that say they are small are left out. */
export function pageIcons(html: string, base: URL): { icons: IconCandidate[]; manifest: string | null } {
  const icons: IconCandidate[] = [];
  let manifest: string | null = null;
  const resolve = (href: string) => {
    try {
      return new URL(href.replace(/&amp;/g, "&"), base).href;
    } catch {
      return null; // an unusable address: skip it
    }
  };
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href")?.trim();
    if (!href || href.startsWith("data:")) continue;
    if (/(^|\s)manifest(\s|$)/.test(rel)) {
      manifest ??= resolve(href);
      continue;
    }
    if (!/(^|\s)(icon|apple-touch-icon(-precomposed)?|mask-icon)(\s|$)/.test(rel)) continue;
    if (/(^|\s)mask-icon(\s|$)/.test(rel)) continue; // Safari's one-colour pinned-tab outline
    const svg = /\.svg(\?|#|$)/i.test(href) || /image\/svg/i.test(attr(tag, "type") ?? "");
    const size = svg ? 512 : declaredSize(attr(tag, "sizes"));
    if (size > 0 && size < 64) continue;
    const url = resolve(href);
    if (url) icons.push({ href: url, kind: rel.includes("apple-touch-icon") ? "touch" : svg ? "svg" : "icon", size });
  }
  return { icons: rankIcons(icons), manifest };
}

/**
 * Up to two images on a page that say they are a logo (in their address, alt text, class or id), as most
 * sites' headers do, then its social preview image (og:image), which small companies often make their
 * logo: often a small company's only sharp one. A plain http address is tried over https.
 */
export function pageLogos(html: string, base: URL): IconCandidate[] {
  const logos: IconCandidate[] = [];
  const add = (src: string) => {
    try {
      const url = new URL(src.replace(/&amp;/g, "&"), base);
      if (url.protocol === "http:") url.protocol = "https:";
      if (!logos.some((l) => l.href === url.href)) logos.push({ href: url.href, kind: "logo", size: 0 });
    } catch {
      // an unusable address: skip it
    }
  };
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = (attr(tag, "src") ?? attr(tag, "data-src"))?.trim();
    if (!src || src.startsWith("data:")) continue;
    if (!/logo/i.test([src, attr(tag, "alt"), attr(tag, "class"), attr(tag, "id")].join(" "))) continue;
    add(src);
    if (logos.length === 2) break;
  }
  const preview = (html.match(/<meta\b[^>]*>/gi) ?? []).find((tag) => /^og:image(:url)?$/i.test(attr(tag, "property") ?? attr(tag, "name") ?? ""));
  const previewSrc = preview && attr(preview, "content")?.trim();
  if (previewSrc && !previewSrc.startsWith("data:")) add(previewSrc);
  return logos;
}

/** A web app manifest's icons, largest first. Monochrome icons (a plain outline for the system to colour) are left out. */
export function manifestIcons(json: string, base: URL): IconCandidate[] {
  let parsed: { icons?: { src?: unknown; sizes?: unknown; purpose?: unknown; type?: unknown }[] };
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const icons: IconCandidate[] = [];
  for (const icon of Array.isArray(parsed?.icons) ? parsed.icons : []) {
    if (typeof icon?.src !== "string" || /monochrome/i.test(String(icon.purpose ?? ""))) continue;
    const svg = /\.svg(\?|#|$)/i.test(icon.src) || /svg/i.test(String(icon.type ?? ""));
    const size = svg ? 512 : declaredSize(typeof icon.sizes === "string" ? icon.sizes : undefined);
    if (size > 0 && size < 64) continue;
    try {
      icons.push({ href: new URL(icon.src, base).href, kind: "manifest", size });
    } catch {
      // an unusable address: skip it
    }
  }
  return rankIcons(icons);
}

/** Best first: by kind, then the largest. Each address once. */
function rankIcons(icons: IconCandidate[]): IconCandidate[] {
  const sorted = [...icons].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.size - a.size);
  return [...new Map(sorted.map((i) => [i.href, i])).values()];
}

/** What a photo looks like from its first bytes. Anything else is not stored. Kept here, free of the database, so it can be unit tested. */
export function imageType(bytes: Buffer): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (bytes.length > 6 && bytes.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  return null;
}

/** Google's public favicon service, for a site that offers nothing sharp itself. Only the domain is sent. */
export const googleIconUrl = (domain: string) =>
  `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=256&url=${encodeURIComponent(`https://${domain}`)}`;

/**
 * Every icon worth trying for a domain, best first: what its home page and manifest name, then the usual
 * addresses. With `logos`, the logo images on its home page too.
 */
export async function candidatesFor(domain: string, options: { logos?: boolean } = {}): Promise<IconCandidate[]> {
  let page = await safeGet(`https://${domain}/`, PAGE_BYTES, true);
  if (!page && !domain.startsWith("www.")) page = await safeGet(`https://www.${domain}/`, PAGE_BYTES, true);
  const base = page?.url ?? new URL(`https://${domain}/`);
  const html = page && /html/i.test(page.type) ? page.bytes.toString("utf8") : null;
  const named = html ? pageIcons(html, base) : { icons: [], manifest: null };
  const logos = html && options.logos ? pageLogos(html, base) : [];
  let fromManifest: IconCandidate[] = [];
  if (named.manifest) {
    const manifest = await safeGet(named.manifest, MANIFEST_BYTES);
    if (manifest) fromManifest = manifestIcons(manifest.bytes.toString("utf8"), manifest.url);
  }
  const guesses: IconCandidate[] = [
    { href: new URL("/apple-touch-icon.png", base).href, kind: "guess", size: 180 },
    { href: new URL("/favicon.ico", base).href, kind: "guess", size: 0 },
  ];
  return rankIcons([...named.icons, ...fromManifest, ...logos, ...guesses]);
}

/**
 * The company's logo as a finished PNG (see logo-image.ts), or null when neither its site nor Google's
 * favicon service offers one sharp enough. `source` says where the chosen icon came from.
 */
export async function siteIcon(domain: string, options: { google?: boolean } = {}): Promise<{ bytes: Buffer; type: string; source: IconKind } | null> {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  let best: { logo: Logo; kind: IconKind } | null = null;
  const consider = async (candidate: IconCandidate) => {
    const icon = await safeGet(candidate.href, ICON_BYTES);
    if (!icon || icon.bytes.length < 100) return;
    const logo = await frameLogo(icon.bytes).catch(() => null);
    if (!logo || logo.quality < MIN_QUALITY) return;
    // Sharper wins; between two sharp enough, the earlier kind.
    if (!best || Math.min(logo.quality, GOOD) > Math.min(best.logo.quality, GOOD)) best = { logo, kind: candidate.kind };
  };
  const good = () => (best?.logo.quality ?? 0) >= GOOD;
  for (const candidate of (await candidatesFor(domain)).slice(0, MAX_TRIES)) {
    await consider(candidate);
    if (good()) break;
  }
  if (!good() && options.google !== false) await consider({ href: googleIconUrl(domain), kind: "google", size: 256 });
  const chosen = best as { logo: Logo; kind: IconKind } | null;
  return chosen ? { bytes: chosen.logo.png, type: "image/png", source: chosen.kind } : null;
}
