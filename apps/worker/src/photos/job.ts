// Once a day, your own address books (iCloud Contacts and Google Contacts) are imported into Contacts
// with their saved names (see import.ts), then matched to the people Messages knows, by email address
// or phone number, so their photos become the contact's photo. WhatsApp profile pictures are fetched
// by the WhatsApp connector and give way to these.

import type { ICloudCredentials } from "../connectors/icloud";
import { saveCards } from "../contacts/cards-store";
import { allRows, db, loadCredentials, must } from "../db";
import { CONTACTS_SCOPE } from "../google/oauth";
import { openGoogleClient } from "../google/session";
import { errorCode, log } from "../log";
import { startEvery } from "../backoff";
import { chunks } from "../util";
import { matchCards, type Card } from "./cards";
import { syncCompanyIcons } from "./company-icons";
import { importCards } from "./import";
import type { Identity } from "./import-plan";
import { fetchGooglePhoto, googleCards } from "./google";
import { fetchICloudPhoto, icloudAuth, icloudCards } from "./icloud";
import { saveContactPhoto, type PhotoSource } from "./store";
import { openAddresses } from "../vault";

const FIRST_RUN_MS = 2 * 60_000;
const EVERY_MS = 24 * 60 * 60_000;
const FRESH_MS = 7 * 24 * 60 * 60_000; // a photo from the same source is fetched again after a week

let started = false;

export function startPhotoSync() {
  if (started) return;
  started = true;
  startEvery(FIRST_RUN_MS, EVERY_MS, runPhotoSync, (err) => log.warn("photo sync failed", { code: errorCode(err) }));
}

async function runPhotoSync() {
  const accounts = must(
    await db.from("accounts").select("id, user_id, provider, status").in("provider", ["icloud", "gmail"]).not("status", "in", "(disconnected,error)"),
    "load photo accounts",
  );
  for (const account of accounts) {
    try {
      await syncAccount(account);
    } catch (err) {
      log.warn("photo sync account failed", { account: account.id, code: errorCode(err) });
    }
  }
  await syncCompanyIcons().catch((err) => log.warn("company icons failed", { code: errorCode(err) }));
}

async function syncAccount(account: { id: string; user_id: string; provider: string }) {
  let source: PhotoSource;
  let cards: Card[];
  let fetchPhoto: (url: string) => Promise<Buffer | null>;
  if (account.provider === "icloud") {
    const auth = icloudAuth(await loadCredentials<ICloudCredentials>(account.id));
    source = "icloud";
    cards = await icloudCards(auth);
    fetchPhoto = (url) => fetchICloudPhoto(auth, url);
  } else {
    let google: Awaited<ReturnType<typeof openGoogleClient>>;
    try {
      google = await openGoogleClient(account.id, CONTACTS_SCOPE);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "NOT_GRANTED" || code === "NO_CLIENT") return; // signed in before contacts were asked for, or no OAuth client
      throw err;
    }
    source = "google";
    cards = await googleCards(google.client);
    fetchPhoto = fetchGooglePhoto;
  }
  await saveCards(account, cards); // for the contact linker; never throws

  // Every card becomes a contact, with its saved name (src/photos/import.ts). New contacts then get photos below.
  let identities = await loadIdentities(account.user_id);
  if ((await importCards(account, cards, identities)) > 0) identities = await loadIdentities(account.user_id);

  const matches = matchCards(cards, identities).flatMap(({ contactId, card }) => (card.photo ? [{ contactId, photo: card.photo }] : []));
  if (matches.length === 0) {
    log.info("photo sync", { account: account.id, source, cards: cards.length, matched: 0, saved: 0 });
    return;
  }

  const contacts = new Map<string, { avatar_source: string | null; avatar_updated_at: string | null }>();
  for (const ids of chunks(matches.map((m) => m.contactId), 100)) {
    for (const c of must(await db.from("contacts").select("id, avatar_source, avatar_updated_at").in("id", ids), "load contacts")) contacts.set(c.id, c);
  }

  const fresh = new Date(Date.now() - FRESH_MS).toISOString();
  let saved = 0;
  for (const { contactId, photo } of matches) {
    const current = contacts.get(contactId);
    if (current?.avatar_source === source && current.avatar_updated_at && current.avatar_updated_at > fresh) continue;
    const bytes = "bytes" in photo ? photo.bytes : await fetchPhoto(photo.url);
    if (bytes && (await saveContactPhoto(account.user_id, contactId, source, bytes, current))) saved++;
  }
  log.info("photo sync", { account: account.id, source, cards: cards.length, matched: matches.length, saved });
}

/** Every identity of the user's contacts, every page of them. */
function loadIdentities(userId: string): Promise<Identity[]> {
  return allRows(
    (from, to) => db.from("contact_identities").select("contact_id, kind, value").eq("user_id", userId).order("id").range(from, to),
    "load identities",
  ).then((rows) => openAddresses(userId, rows));
}
