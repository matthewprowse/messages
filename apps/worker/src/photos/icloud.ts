import type { ICloudCredentials } from "../connectors/icloud";
import { parseVCard, unescapeXml, vcardsFromMultistatus, type Card } from "./cards";

// iCloud Contacts over CardDAV, signed in with the same app-specific password as iCloud Mail. Read only:
// it finds your address books and reads their cards, nothing is ever written.

const ROOT = "https://contacts.icloud.com/";
const DAV = 'xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"';

/** The Authorization header for this sign-in, built once and passed to every request. */
export function icloudAuth(creds: ICloudCredentials): string {
  return `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
}

async function dav(auth: string, url: string, method: "PROPFIND" | "REPORT", depth: 0 | 1, body: string): Promise<string> {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: auth,
      depth: String(depth),
      "content-type": "application/xml; charset=utf-8",
    },
    body: `<?xml version="1.0" encoding="utf-8"?>${body}`,
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status !== 207) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error("carddav request failed"), { code: `HTTP_${response.status}` });
  }
  return response.text();
}

function hrefIn(xml: string, property: string): string | null {
  const block = new RegExp(`<(?:\\w+:)?${property}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${property}>`).exec(xml)?.[1];
  const href = block && /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/.exec(block)?.[1];
  return href ? unescapeXml(href.trim()) : null;
}

/** Every card from all of the account's address books. */
export async function icloudCards(auth: string): Promise<Card[]> {
  const principalXml = await dav(auth, ROOT, "PROPFIND", 0, `<d:propfind ${DAV}><d:prop><d:current-user-principal/></d:prop></d:propfind>`);
  const principal = hrefIn(principalXml, "current-user-principal");
  if (!principal) throw Object.assign(new Error("no principal"), { code: "NO_PRINCIPAL" });

  const homeXml = await dav(auth, new URL(principal, ROOT).href, "PROPFIND", 0, `<d:propfind ${DAV}><d:prop><card:addressbook-home-set/></d:prop></d:propfind>`);
  const home = hrefIn(homeXml, "addressbook-home-set");
  if (!home) throw Object.assign(new Error("no address book home"), { code: "NO_HOME" });
  const homeUrl = new URL(home, ROOT).href;

  const listXml = await dav(auth, homeUrl, "PROPFIND", 1, `<d:propfind ${DAV}><d:prop><d:resourcetype/></d:prop></d:propfind>`);
  const books: string[] = [];
  for (const m of listXml.matchAll(/<(?:\w+:)?response[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/g)) {
    if (!/<(?:\w+:)?addressbook(\s[^>]*)?\/>/.test(m[1])) continue;
    const href = /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/.exec(m[1])?.[1];
    if (href) books.push(new URL(unescapeXml(href.trim()), homeUrl).href);
  }

  const cards: Card[] = [];
  for (const book of books) {
    const xml = await dav(
      auth,
      book,
      "REPORT",
      1,
      `<card:addressbook-query ${DAV}><d:prop><d:getetag/><card:address-data/></d:prop></card:addressbook-query>`,
    );
    for (const vcard of vcardsFromMultistatus(xml)) {
      const card = parseVCard(vcard);
      if (card.photo || card.name) cards.push(card);
    }
  }
  return cards;
}

/** A photo iCloud keeps at its own address needs the same sign-in. Other hosts are not contacted. */
export async function fetchICloudPhoto(auth: string, url: string): Promise<Buffer | null> {
  if (!/^https:\/\/[\w.-]+\.icloud\.com\//i.test(url)) return null;
  const response = await fetch(url, {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  return response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
}
