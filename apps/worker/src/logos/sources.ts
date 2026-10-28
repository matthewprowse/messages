import { createHash } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { sleep } from "../backoff";
import { candidatesFor, googleIconUrl, pageIcons, pageLogos, safeGet } from "../photos/site-icon";

// Where a company's logo may be found, all free and keyless: the App Store, BIMI, the company's own site,
// Google's favicon service, Wikidata (Wikimedia Commons files) and Simple Icons, and, when none of those
// passes the judge, the addresses Gemini found with Google Search. Each finder returns raw image files;
// framing and judging happen elsewhere (pipeline.ts). Only a company's name and domain are ever sent,
// never an address or any mail. Every fetch goes through safeGet: public HTTPS only, small and quick.

export type LogoSource = "app_store" | "bimi" | "site" | "google" | "wikidata" | "simple_icons" | "search";
/** The order candidates are numbered in for the judge: likely best first, single-colour Simple Icons last. */
export const SOURCE_ORDER: LogoSource[] = ["app_store", "bimi", "site", "wikidata", "google", "search", "simple_icons"];

export interface Found {
  source: LogoSource;
  url: string;
  bytes: Buffer;
  /** What the judge is told besides the picture: an app's name and publisher, say. */
  note?: string;
}

const ICON_BYTES = 1024 * 1024;
const JSON_BYTES = 1024 * 1024;
const PAGE_BYTES = 1024 * 1024;
/** How many of a site's icons are fetched. */
const SITE_TRIES = 8;
/** Wikimedia asks every client to say who it is. */
const WIKI_HEADERS = { "user-agent": "Konva/1.0 (company logo lookup)" };
/**
 * Wikimedia allows a client that gives no contact address about 10 requests a minute: one every 6.5
 * seconds, shared by every company. Two are made for each company; the files come from its media servers.
 */
const WIKI_GAP_MS = 6_500;
/** The Simple Icons release used; its data names every icon's brand colour. */
const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@16.36.0";
/** Apple allows about 20 App Store searches a minute: one every 3.1 seconds, shared by every company. */
const ITUNES_GAP_MS = 3_100;

export const squash = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when a host is the domain or one of its subdomains. */
export const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
};

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  const res = await safeGet(url, JSON_BYTES, false, { accept: "application/json", ...headers });
  if (!res) return null;
  try {
    return JSON.parse(res.bytes.toString("utf8")) as T;
  } catch {
    return null;
  }
}

async function image(source: LogoSource, url: string, note?: string, headers: Record<string, string> = {}): Promise<Found | null> {
  const res = await safeGet(url, ICON_BYTES, false, headers);
  if (!res || res.bytes.length < 100 || /html/i.test(res.type)) return null;
  return { source, url, bytes: res.bytes, note };
}

// ---------------------------------------------------------------------------------------------------------
// App Store

export interface StoreApp {
  trackName: string;
  sellerName?: string;
  artistName?: string;
  sellerUrl?: string;
  bundleId?: string;
  artworkUrl512?: string;
}

/** A turn-taker for a service with a rate limit: each call waits until `gap` after the one before it. */
function spaced(gap: number) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await sleep(at - now);
  };
}
const itunesTurn = spaced(ITUNES_GAP_MS);
const wikiTurn = spaced(WIKI_GAP_MS);

/**
 * Whether an app is the company's own, not another publisher's that shares the name: its publisher's site
 * is on the company's domain, its bundle ID starts with the domain backwards (za.co.fnb), its publisher is
 * named for the company, or its name and its publisher's page both name it (Checkers Sixty60, published
 * by Shoprite Checkers at checkers.co.za/sixty60).
 */
export function publisherMatches(app: StoreApp, name: string, domain: string): boolean {
  if (onDomain(hostOf(app.sellerUrl), domain)) return true;
  const reversed = domain.split(".").reverse().join(".");
  if ((app.bundleId ?? "").toLowerCase().startsWith(`${reversed}.`)) return true;
  const company = squash(name);
  if (company.length < 3) return false;
  if ([app.sellerName, app.artistName].some((p) => p && squash(p).includes(company))) return true;
  let path = "";
  try {
    path = app.sellerUrl ? squash(new URL(app.sellerUrl).pathname) : "";
  } catch {
    // no usable address
  }
  return path.includes(company) && squash(app.trackName).includes(company);
}

/** Up to two of the company's own apps' icons, from the South African App Store, else the American one. */
export async function appStore(name: string, domain: string): Promise<Found[]> {
  for (const country of ["za", "us"]) {
    await itunesTurn();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&country=${country}&entity=software&limit=5`;
    const results = (await getJson<{ results?: StoreApp[] }>(url))?.results ?? [];
    const own = results.filter((app) => app.artworkUrl512 && publisherMatches(app, name, domain)).slice(0, 2);
    if (own.length === 0) continue;
    const found = await Promise.all(own.map((app) => image("app_store", app.artworkUrl512!, `App Store app "${app.trackName}" by ${app.sellerName ?? app.artistName ?? "an unnamed publisher"}`)));
    return found.filter((f): f is Found => !!f);
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------------
// BIMI: the logo a domain publishes for mail apps, in DNS at default._bimi.<domain>.

export function bimiLogoUrl(records: string[][]): string | null {
  const record = records.map((r) => r.join("").trim()).find((r) => /^v=BIMI1\b/i.test(r));
  const url = record && /(?:^|;)\s*l=([^;\s]+)/i.exec(record)?.[1];
  return url && url.startsWith("https://") ? url : null;
}

export async function bimi(domain: string): Promise<Found[]> {
  const url = bimiLogoUrl(await resolveTxt(`default._bimi.${domain}`).catch(() => []));
  const found = url && (await image("bimi", url));
  return found ? [found] : [];
}

// ---------------------------------------------------------------------------------------------------------
// The company's own site, and Google's favicon service.

export async function site(domain: string): Promise<Found[]> {
  const candidates = (await candidatesFor(domain, { logos: true }).catch(() => [])).slice(0, SITE_TRIES);
  const found = await Promise.all(candidates.map((c) => image("site", c.href)));
  return found.filter((f): f is Found => !!f);
}

export async function google(domain: string): Promise<Found[]> {
  const found = await image("google", googleIconUrl(domain));
  return found ? [found] : [];
}

// ---------------------------------------------------------------------------------------------------------
// Wikidata: the item whose official website is on the domain, and its logo files (P154 logo image, P8972
// small logo or icon) on Wikimedia Commons, current ones first.

interface Claim {
  rank?: string;
  mainsnak?: { datavalue?: { value?: unknown } };
  qualifiers?: Record<string, unknown>;
}
type Claims = Record<string, Claim[] | undefined>;

/** The current files of one property, preferred first; ones with an end date (an old logo) are left out. */
export function currentFiles(claims: Claims, property: string): string[] {
  return (claims[property] ?? [])
    .filter((c) => c.rank !== "deprecated" && !c.qualifiers?.P582 && typeof c.mainsnak?.datavalue?.value === "string")
    .sort((a, b) => Number(b.rank === "preferred") - Number(a.rank === "preferred"))
    .map((c) => c.mainsnak!.datavalue!.value as string);
}

/**
 * A Commons file's address on Wikimedia's media servers: a 500px PNG drawing of an SVG (one of the widths it serves), or a raster file
 * itself. Files live under the first one and two hex digits of the MD5 of their name.
 */
export function commonsFileUrl(file: string): string {
  const name = file.replace(/ /g, "_");
  const hash = createHash("md5").update(name).digest("hex");
  const at = `${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(name)}`;
  return /\.svg$/i.test(name)
    ? `https://upload.wikimedia.org/wikipedia/commons/thumb/${at}/500px-${encodeURIComponent(name)}.png`
    : `https://upload.wikimedia.org/wikipedia/commons/${at}`;
}

/** The file an English Wikipedia infobox names as its logo ("| logo = Checkers logo.svg"), or null. */
export function infoboxLogo(wikitext: string): string | null {
  return /^\s*\|\s*logo\s*=\s*(?:\[\[)?(?:File:|Image:)?\s*([^|\]\n{}]+?\.(?:svg|png|jpe?g|gif|webp))\b/im.exec(wikitext)?.[1].trim() ?? null;
}

/**
 * The item found by the company's name whose official website is on its domain: its logo files, or when
 * it has none, the logo its English Wikipedia article's infobox names (often kept on Wikipedia itself,
 * as a non-free file, rather than on Commons). Two to four requests.
 */
export async function wikidata(name: string, domain: string): Promise<Found[]> {
  const api = "https://www.wikidata.org/w/api.php";
  await wikiTurn();
  const search = await getJson<{ search?: { id: string }[] }>(`${api}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=20&format=json`, WIKI_HEADERS);
  const ids = (search?.search ?? []).map((s) => s.id).filter((id) => /^Q\d+$/.test(id));
  if (ids.length === 0) return [];
  await wikiTurn();
  type Entity = { claims?: Claims; sitelinks?: { enwiki?: { title?: string } } };
  const got = await getJson<{ entities?: Record<string, Entity> }>(`${api}?action=wbgetentities&ids=${ids.join("|")}&props=claims|sitelinks&sitefilter=enwiki&format=json`, WIKI_HEADERS);
  for (const id of ids) {
    const claims = got?.entities?.[id]?.claims ?? {};
    const sites = (claims.P856 ?? []).map((c) => c.mainsnak?.datavalue?.value).filter((v): v is string => typeof v === "string");
    if (!sites.some((s) => onDomain(hostOf(s), domain))) continue;
    const files = [...currentFiles(claims, "P8972").slice(0, 1), ...currentFiles(claims, "P154").slice(0, 2)];
    if (files.length > 0) {
      const found = await Promise.all(files.map((file) => image("wikidata", commonsFileUrl(file), `Wikimedia Commons file "${file}"`, WIKI_HEADERS)));
      return found.filter((f): f is Found => !!f);
    }
    const title = got?.entities?.[id]?.sitelinks?.enwiki?.title;
    if (!title) return [];
    await wikiTurn();
    const page = await getJson<{ parse?: { wikitext?: string } }>(
      `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&section=0&format=json&formatversion=2`,
      WIKI_HEADERS,
    );
    const file = infoboxLogo(page?.parse?.wikitext ?? "");
    if (!file) return [];
    await wikiTurn();
    const found = await image("wikidata", `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=500`, `The logo in the Wikipedia article "${title}"`, WIKI_HEADERS);
    return found ? [found] : [];
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------------
// Simple Icons: one-colour marks, drawn here in the brand's colour.

interface SimpleIcon {
  title: string;
  slug: string;
  hex: string;
  source?: string;
  guidelines?: string;
}
let simpleData: Promise<SimpleIcon[]> | null = null;

/**
 * The icon named for the company or its domain ("booking.com" is Booking.com's). An icon whose source is
 * merely on the domain is not enough: many brands' files are kept on figma.com or github.com.
 */
export function simpleIconFor(icons: SimpleIcon[], name: string, domain: string): SimpleIcon | null {
  const keys = new Set([squash(name), squash(domain), squash(domain.split(".")[0])].filter((k) => k.length >= 3));
  return icons.find((i) => keys.has(squash(i.title)) || keys.has(i.slug)) ?? null;
}

export async function simpleIcons(name: string, domain: string): Promise<Found[]> {
  simpleData ??= getJson<SimpleIcon[]>(`${SIMPLE_ICONS}/data/simple-icons.json`).then((d) => (Array.isArray(d) ? d : []));
  const icons = await simpleData;
  if (icons.length === 0) simpleData = null; // try again next time
  const icon = simpleIconFor(icons, name, domain);
  if (!icon || !/^[0-9a-f]{6}$/i.test(icon.hex)) return [];
  const url = `${SIMPLE_ICONS}/icons/${icon.slug}.svg`;
  const svg = await safeGet(url, ICON_BYTES);
  if (!svg) return [];
  const coloured = svg.bytes.toString("utf8").replace(/<svg\b/, `<svg fill="#${icon.hex}"`);
  return [{ source: "simple_icons", url, bytes: Buffer.from(coloured), note: `Simple Icons "${icon.title}", one colour` }];
}

// ---------------------------------------------------------------------------------------------------------
// Addresses Gemini found with Google Search: an image itself, or a page whose icons and preview image are tried.

export async function searchResults(urls: string[]): Promise<Found[]> {
  const sites = new Set<string>();
  const found = await Promise.all(
    urls.slice(0, 6).map(async (url): Promise<Found[]> => {
      const res = await safeGet(url, PAGE_BYTES, true);
      if (!res) return [];
      if (!/html/i.test(res.type)) return res.bytes.length >= 100 ? [{ source: "search", url, bytes: res.bytes, note: "Found with Google Search" }] : [];
      const html = res.bytes.toString("utf8");
      const note = `Found with Google Search on ${res.url.hostname}`;
      // The page's icons and logo images, and Google's icon for its site (the company's own site, often).
      sites.add(res.url.hostname.replace(/^www\./, ""));
      const addresses = [...pageIcons(html, res.url).icons.slice(0, 2), ...pageLogos(html, res.url)].map((i) => i.href);
      const images = await Promise.all(addresses.map((a) => image("search", a, note)));
      return images.filter((f): f is Found => !!f);
    }),
  );
  const favicons = await Promise.all([...sites].slice(0, 2).map((host) => image("search", googleIconUrl(host), `Google's icon for ${host}, found with Google Search`)));
  return [...found.flat(), ...favicons.filter((f): f is Found => !!f)];
}

/** Every free source at once, for the first round. */
export async function gather(name: string, domain: string): Promise<Found[]> {
  const settled = await Promise.all([
    appStore(name, domain),
    bimi(domain),
    site(domain),
    google(domain),
    wikidata(name, domain),
    simpleIcons(name, domain),
  ].map((p) => p.catch(() => [] as Found[])));
  return settled.flat();
}
