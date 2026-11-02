// WhatsApp, as a linked device (the way WhatsApp Web works) through Baileys. Messages and the history the
// phone sends when the device links are stored like email; replies queued in the outbox go out over the
// link. Nothing is ever sent on its own: no presence, no "online", and read receipts only when you open a
// chat in the app with read receipts turned on in Settings.
//
// Memory and reads: the name, chat, group, privacy ID and download-count maps are size-bounded (least recently
// used first, ../whatsapp/bounded-map.ts) and re-derived on demand; groups are cleared on reconnect. The
// ten-minute missing-file catch-up asks the database nothing while the link is down or nothing is missing, and
// looks for old stickers only when the recent pass found work or once an hour.

import makeWASocket, {
  Browsers,
  DisconnectReason,
  WAMessageStubType,
  fetchLatestWaWebVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type AnyMessageContent,
  type BaileysEventMap,
  type Chat,
  type Contact,
  type GroupMetadata,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
  type proto,
} from "baileys";
import type { Json, Tables } from "@messages/db";
import { Backoff, SerialQueue, sleep } from "../backoff";
import { finishAction, NotReady } from "../send/actions";
import { allRows, db, getSyncState, must, recordEvent, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { MAX_FILE_BYTES } from "../file-store";
import { isFailure } from "../ingest/batch-rpc";
import { claimReady, linkThread, markFailed, onInboxList, settleSent, type OutboxRow } from "../send/outbox";
import { replyFor } from "../send/inbox";
import { loadAttachmentFiles } from "../send/outbox-attachments";
import { newChatNumber, outgoingMessages } from "../whatsapp/outgoing";
import { prepareVoiceNotes } from "../whatsapp/voice-note";
import { isLinked, useDbAuthState, type DbAuthState } from "../whatsapp/auth-state";
import { silentLogger } from "../whatsapp/logger";
import { BoundedMap } from "../whatsapp/bounded-map";
import { messageFromRef, mediaRef, saveMedia, type MediaRow, type StoredMedia } from "../whatsapp/media";
import { describe, e164, formatPairingCode, nameMentions, oneLine, pairingDigits, unreadInHistory } from "../whatsapp/normalize";
import { quietSignalLogs } from "../whatsapp/quiet-signal";
import { HISTORY_PER_CALL, ingestWhatsApp, ingestWhatsAppHistory, type WhatsAppStored } from "../whatsapp/ingest";
import { retryStore } from "../whatsapp/retry";
import { saveContactPhoto, saveGroupPhoto } from "../photos/store";
import { chunks, mapLimit } from "../util";
import { FIELD } from "@messages/crypto/fields";
import { addressIndex, chatIndex } from "@messages/crypto/addresses";
import type { UserKeys } from "@messages/crypto";
import { keysFor, open, openAddresses, seal, sealAddress } from "../vault";

quietSignalLogs();

const MEDIA_CATCH_UP_MS = 10 * 60_000;
const STICKER_PASS_IDLE_MS = 60 * 60_000; // old stickers are looked for this rarely once a pass finds none missing
const SPENT_IN_QUERY = 300; // files past their tries named in the catch-up query, newest first, to keep the URL short
// Memory bounds for the per-account Maps below (least recently used goes first). All of it is worked out again
// from the database or the socket when needed, so a dropped entry costs a lookup, not correctness.
const MAX_NAMES = 20_000;
const MAX_CHATS = 5_000;
const MAX_GROUPS = 2_000;
const MAX_LIDS = 20_000;
const MAX_FILE_TRY_ENTRIES = 5_000;
const TOUCH_MS = 60_000;
const SELF = "me"; // who you are in provider_meta.reactions; anyone else is their number's or privacy ID's index
const MAX_FILE_TRIES = 3; // per file, per worker run
const NAMES_RESYNC_DELAY_MS = 30_000;
const PHOTO_REFRESH_MS = 24 * 60 * 60_000; // look for new profile pictures once a day
const PHOTO_STALE_MS = 7 * 24 * 60 * 60_000;
const PHOTO_PAUSE_MS = 2_000; // one lookup at a time, like WhatsApp Web loading pictures as you scroll

/** A WhatsApp person: phone number in E.164 and privacy ID, whichever are known, and the best name. */
interface Person {
  phone: string | null;
  lid: string | null;
  /** Preferred JID: the phone number's, else the privacy ID's. */
  jid: string;
  display_name: string;
  push_name: string | null;
}

interface StoredMeta {
  chat: string;
  from_me: boolean;
  participant: string | null;
  media?: StoredMedia;
  receipt?: string;
}

type Outcome = "reconnect" | "restart" | "stop";

/** A message ready to store, and what to do once it is stored (returns true when it was new). */
interface Prepared {
  payload: Json;
  finish: (stored: WhatsAppStored) => boolean;
}

export class WhatsAppConnector {
  private sock: WASocket | null = null;
  private auth: DbAuthState | null = null;
  private open = false;
  private stopped = false;
  private readonly backoff = new Backoff();
  /** Message storage runs in order, one at a time, so history and live messages never race. */
  private readonly queue = new SerialQueue();
  /** File downloads, one at a time, apart from message storage so a slow file never holds up messages. */
  private readonly media = new SerialQueue();
  private timers: NodeJS.Timeout[] = [];
  /** Names by JID: saved on your phone (wins) or set by the person. Also by privacy ID. */
  private savedNames = new BoundedMap<string, string>(MAX_NAMES);
  private pushNames = new BoundedMap<string, string>(MAX_NAMES);
  private groups = new BoundedMap<string, GroupMetadata>(MAX_GROUPS);
  private chats = new BoundedMap<string, { name?: string | null; archived?: boolean | null }>(MAX_CHATS);
  /** Download attempts per file this run, so one that cannot be fetched is not retried forever. */
  private fileTries = new BoundedMap<string, number>(MAX_FILE_TRY_ENTRIES);
  /** Phone JIDs by privacy ID, as the link reports them; null when it did not know one yet. */
  private pnByLid = new BoundedMap<string, string | null>(MAX_LIDS);
  /** Privacy IDs already mapped in the database this run, so repeated history batches skip the write. */
  private mappedLids = new BoundedMap<string, string>(MAX_LIDS);
  private historyBatches = 0;
  private photosRunning = false;
  private lastMediaCatchUp = 0;
  /** When the sticker pass of the media catch-up last found nothing missing; it then waits STICKER_PASS_IDLE_MS. */
  private stickersIdleSince = 0;

  constructor(private readonly account: AccountRow) {}

  get id() {
    return this.account.id;
  }

  start() {
    void this.run();
  }

  async stop() {
    this.stopped = true;
    this.clearTimers();
    // end() closes the socket without logging out, so the link stays valid for the next start.
    this.sock?.end(undefined);
  }

  private clearTimers() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private async run() {
    while (!this.stopped) {
      let outcome: Outcome = "reconnect";
      try {
        outcome = await this.session();
      } catch (err) {
        if (this.stopped) break;
        log.warn("whatsapp session failed", { account: this.id, code: errorCode(err) });
        await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
      }
      this.open = false;
      this.clearTimers();
      if (this.stopped || outcome === "stop") break;
      if (outcome === "restart") continue; // WhatsApp asks for a fresh connection right after linking
      const delay = this.backoff.next();
      log.info("whatsapp reconnecting", { account: this.id, inMs: delay });
      await sleep(delay);
    }
  }

  /** One connection, from opening the socket until it closes. Resolves with what to do next. */
  private async session(): Promise<Outcome> {
    let auth = await useDbAuthState(this.id);
    // A link that never completed has nothing worth keeping, so each attempt starts from a clean session.
    if (!isLinked(auth.state.creds)) {
      await auth.wipe();
      auth = await useDbAuthState(this.id);
    }
    this.auth = auth;
    const linked = isLinked(auth.state.creds);
    const pairingPhone = linked
      ? null
      : pairingDigits(must(await db.from("accounts").select("pairing_phone").eq("id", this.id).single(), "load whatsapp account").pairing_phone);
    await setAccountStatus(this.id, "connecting", linked ? null : "Getting a code from WhatsApp.");
    for (const [lid, pn] of this.pnByLid) if (!pn) this.pnByLid.delete(lid);
    // Both are rebuilt by the link on open (group list) or by the next history batch (database mapping writes).
    this.groups.clear();
    this.mappedLids.clear();

    // The bundled WhatsApp Web version goes stale; ask for the current one (kept for a few hours, so a
    // reconnect does not ask again), else use the bundled one.
    const latest = await latestWebVersion();
    const sock = makeWASocket({
      ...(latest?.isLatest ? { version: latest.version } : {}),
      auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, silentLogger) },
      logger: silentLogger,
      // Baileys' default. A pairing code is refused for a desktop app client, so this links as Chrome on a Mac.
      browser: Browsers.macOS("Chrome"),
      markOnlineOnConnect: false, // so your phone keeps getting notifications
      syncFullHistory: false,
      shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidNewsletter(jid),
      getMessage: (key) => this.storedMessage(key),
      cachedGroupMetadata: async (jid) => this.groups.get(jid),
      generateHighQualityLinkPreview: false,
    });
    this.sock = sock;

    return new Promise<Outcome>((resolve) => {
      let pairingRequested = false;
      sock.ev.process(async (events) => {
        try {
          if (events["creds.update"]) await auth.saveCreds();

          const update = events["connection.update"];
          if (update?.qr && !this.stopped) {
            await this.showQr(update.qr);
            if (pairingPhone && !pairingRequested) {
              pairingRequested = true;
              const code = await sock.requestPairingCode(pairingPhone);
              must(await db.from("accounts").update({ pairing_code: formatPairingCode(code) }).eq("id", this.id), "save pairing code");
              log.info("whatsapp pairing code ready", { account: this.id });
            }
          }
          if (update?.connection === "open") await this.onOpen(sock);
          if (update?.connection === "close") {
            this.open = false;
            resolve(await this.onClose(update.lastDisconnect?.error, linked || isLinked(auth.state.creds)));
            return;
          }

          // Each payload is taken out first, so a queued step holds only its own part of the batch.
          const history = events["messaging-history.set"];
          const upsert = events["messages.upsert"];
          const updates = events["messages.update"];
          const reactions = events["messages.reaction"];
          const newContacts = events["contacts.upsert"];
          const contactUpdates = events["contacts.update"] as Contact[] | undefined;
          const chatUpdates = events["chats.update"];
          const newGroups = events["groups.upsert"];
          const groupUpdates = events["groups.update"] as GroupMetadata[] | undefined;
          const lidMapping = events["lid-mapping.update"];
          if (history) this.background(() => this.onHistory(history));
          if (upsert) this.background(() => this.onMessages(upsert.messages, upsert.type === "notify"));
          if (updates) this.background(() => this.onUpdates(updates));
          if (reactions) this.background(() => this.onReactions(reactions));
          if (newContacts) this.background(() => this.onContacts(newContacts));
          if (contactUpdates) this.background(() => this.onContacts(contactUpdates));
          if (events["chats.upsert"]) this.rememberChats(events["chats.upsert"]);
          if (chatUpdates) this.background(() => this.onChatUpdates(chatUpdates));
          if (newGroups) this.background(() => this.onGroups(newGroups));
          if (groupUpdates) this.background(() => this.onGroups(groupUpdates));
          if (lidMapping) this.background(() => this.onLidMapping([lidMapping]));
        } catch (err) {
          log.warn("whatsapp event failed", { account: this.id, code: errorCode(err) });
        }
      });
    });
  }

  private async showQr(qr: string) {
    must(
      await db
        .from("accounts")
        .update({ qr_code: qr, status: "connecting", status_detail: "Scan the QR code with WhatsApp on your phone." })
        .eq("id", this.id),
      "save qr code",
    );
    log.info("whatsapp qr code ready", { account: this.id });
  }

  private async onOpen(sock: WASocket) {
    this.open = true;
    this.backoff.reset();
    const me = sock.user;
    const phone = e164(me?.id);
    must(
      await db
        .from("accounts")
        .update({
          status: "connected",
          status_detail: null,
          last_synced_at: new Date().toISOString(),
          qr_code: null,
          pairing_code: null,
          pairing_phone: null,
          label: "WhatsApp",
          ...(phone ? { address: await sealAddress(this.account.user_id, phone) } : {}),
        })
        .eq("id", this.id),
      "save linked account",
    );
    log.info("whatsapp connected", { account: this.id });

    // Group names for conversations already stored, and for sending to groups.
    this.background(async () => {
      const groups = await sock.groupFetchAllParticipating();
      await this.onGroups(Object.values(groups));
    });
    this.timers.push(setInterval(() => this.background(() => this.saveMissingMedia()), MEDIA_CATCH_UP_MS));
    this.timers.push(setInterval(() => void touchAccount(this.id), TOUCH_MS));
    // A reconnect soon after the last catch-up has nothing new to fetch; the timer above keeps it going.
    if (Date.now() - this.lastMediaCatchUp > MEDIA_CATCH_UP_MS) {
      this.lastMediaCatchUp = Date.now();
      this.background(() => this.saveMissingMedia());
    }
    void this.refreshSavedNames(sock).catch((err) => log.warn("whatsapp names refresh failed", { account: this.id, code: errorCode(err) }));
    const photos = () => void this.syncPhotos(sock).catch((err) => log.warn("whatsapp photos failed", { account: this.id, code: errorCode(err) }));
    this.timers.push(setTimeout(photos, NAMES_RESYNC_DELAY_MS * 2), setInterval(photos, PHOTO_REFRESH_MS));
  }

  private async onClose(error: Error | undefined, wasLinked: boolean): Promise<Outcome> {
    const status = (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
    log.info("whatsapp connection closed", { account: this.id, status: status ?? null });
    if (this.stopped) return "stop";

    if (status === DisconnectReason.restartRequired) return "restart";
    if (status === DisconnectReason.loggedOut) {
      // The phone removed this device, or the link lapsed because the phone was offline for 14 days.
      // The session is useless now, so it is wiped and a new link starts from a fresh QR code.
      await this.auth?.wipe().catch((err) => log.warn("whatsapp wipe failed", { account: this.id, code: errorCode(err) }));
      await this.linkFailed("WhatsApp unlinked this device. Scan the QR code again.");
      log.warn("whatsapp logged out", { account: this.id });
      return "stop";
    }
    if (!wasLinked && status === DisconnectReason.timedOut) {
      await this.linkFailed("The code expired before it was scanned. Scan the QR code again.");
      return "stop";
    }
    if (status === DisconnectReason.connectionReplaced) {
      await setAccountStatus(this.id, "error", "Another copy of the worker took over this WhatsApp link. Stop the other one, then reconnect.").catch(() => undefined);
      return "stop";
    }
    if (status === DisconnectReason.forbidden || status === DisconnectReason.multideviceMismatch) {
      await this.auth?.wipe().catch(() => undefined);
      await setAccountStatus(this.id, "error", "WhatsApp refused this device. Scan the QR code again.").catch(() => undefined);
      return "stop";
    }
    await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
    return "reconnect";
  }

  /** Ends a link that needs you: the old codes go, and the reason shows in Settings. */
  private async linkFailed(detail: string) {
    const account = await db.from("accounts").select("user_id").eq("id", this.id).maybeSingle();
    if (account.data) {
      recordEvent(account.data.user_id, "sync_error", { provider: "whatsapp", code: "link_failed" });
      recordEvent(account.data.user_id, "account_connect", { provider: "whatsapp", step: "link", outcome: "failed", code: "link_failed" });
    }
    must(
      await db.from("accounts").update({ qr_code: null, pairing_code: null, status: "error", status_detail: detail }).eq("id", this.id),
      "update account status",
    );
  }

  // ---------------------------------------------------------------------------
  // People and chats
  // ---------------------------------------------------------------------------

  private nameOf(...jids: (string | null | undefined)[]): string | null {
    for (const jid of jids) if (jid && this.savedNames.has(jid)) return this.savedNames.get(jid)!;
    for (const jid of jids) if (jid && this.pushNames.has(jid)) return this.pushNames.get(jid)!;
    return null;
  }

  /** Works out who a JID is: phone number and privacy ID where WhatsApp has told us both. */
  private async person(jid: string, alt?: string | null, pushName?: string | null): Promise<Person> {
    const ids = [jid, alt].filter((j): j is string => !!j).map((j) => jidNormalizedUser(j));
    let pn = ids.find((j) => isPnUser(j)) ?? null;
    const lid = ids.find((j) => isLidUser(j)) ?? null;
    if (lid && pn) this.pnByLid.set(lid, pn);
    else if (lid) {
      if (!this.pnByLid.has(lid)) {
        const found = await this.sock?.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
        this.pnByLid.set(lid, found ? jidNormalizedUser(found) : null);
      }
      pn = this.pnByLid.get(lid) ?? null;
    }
    const phone = e164(pn);
    if (pushName) for (const j of [pn, lid]) if (j && !this.pushNames.has(j)) this.pushNames.set(j, pushName);
    return {
      phone,
      lid,
      jid: pn ?? lid ?? jidNormalizedUser(jid),
      display_name: this.nameOf(pn, lid) ?? pushName ?? phone ?? lid ?? jid,
      push_name: pushName ?? (pn && this.pushNames.get(pn)) ?? (lid && this.pushNames.get(lid)) ?? null,
    };
  }

  private isMe(person: Person): boolean {
    const me = this.sock?.user;
    if (!me) return false;
    const mine = [me.id, me.lid].filter(Boolean).map((j) => jidNormalizedUser(j!));
    return mine.includes(person.jid) || (!!person.lid && mine.includes(person.lid));
  }

  private rememberChats(chats: Chat[]) {
    for (const c of chats) if (c.id) this.chats.set(jidNormalizedUser(c.id), { name: c.name, archived: c.archived });
  }

  private async onContacts(contacts: Partial<Contact>[]) {
    const people: Awaited<ReturnType<typeof personJson>>[] = [];
    const keys = await keysFor(this.account.user_id);
    for (const c of contacts) {
      if (!c.id) continue;
      const jids = [c.id, c.lid, c.phoneNumber].filter((j): j is string => !!j).map((j) => jidNormalizedUser(j));
      for (const j of jids) {
        if (c.name) this.savedNames.set(j, c.name);
        if (c.notify) this.pushNames.set(j, c.notify);
      }
      // A saved name wins. A name the person set for themselves only replaces a bare number (decided in SQL).
      const name = c.name ?? c.verifiedName ?? c.notify ?? null;
      if (!name) continue;
      people.push(
        await personJson(keys, {
          phone: e164(jids.find((j) => isPnUser(j))),
          lid: jids.find((j) => isLidUser(j)) ?? null,
          display_name: name,
          push_name: c.notify ?? null,
        }, this.account.user_id),
      );
    }
    if (people.length === 0) {
      log.info("whatsapp names received", { account: this.id, contacts: contacts.length, names: 0, known: 0 });
      return;
    }
    let known = 0;
    for (const batch of chunks(people, 200)) {
      known += must(await db.rpc("whatsapp_contact_names", { p_account_id: this.id, p_people: batch }), "save whatsapp names");
    }
    log.info("whatsapp names received", { account: this.id, contacts: contacts.length, names: people.length, known });
  }

  /**
   * Saved contact names reach a linked device once, in the first app state sync after linking. If the
   * worker restarts during that sync they are lost, and WhatsApp does not send them again on reconnect.
   * So, once per account, the contacts collection is fetched again from scratch.
   */
  private async refreshSavedNames(sock: WASocket) {
    if ((await getSyncState(this.id, "contacts"))?.sync_token) return;
    await sleep(NAMES_RESYNC_DELAY_MS); // let the first sync after linking finish
    if (sock !== this.sock || !this.open || this.stopped) return;
    await sock.authState.keys.set({ "app-state-sync-version": { critical_unblock_low: null } });
    await sock.resyncAppState(["critical_unblock_low"], true);
    await saveSyncState(this.id, "contacts", { sync_token: new Date().toISOString() });
    log.info("whatsapp contact names refreshed", { account: this.id });
  }

  /** Keeps group metadata for sending, and stores group names that changed. One read, then only the writes needed. */
  private async onGroups(groups: Partial<GroupMetadata>[]) {
    const named = new Map<string, string>();
    for (const g of groups) {
      if (!g.id) continue;
      if (g.subject !== undefined && "participants" in g) this.groups.set(g.id, g as GroupMetadata);
      if (g.subject) named.set(g.id, g.subject);
    }
    if (named.size === 0) return;

    // Conversations are found by their chat's index: the database matches on that, not the JID.
    const keys = await keysFor(this.account.user_id);
    const indexes = new Map(await Promise.all([...named.keys()].map(async (id) => [id, await chatIndex(keys, id)] as const)));
    const stored = new Map<string, string | null>();
    for (const batch of chunks([...indexes.values()], 100)) {
      const rows = must(
        await db.from("threads").select("provider_thread_index, group_name").eq("account_id", this.id).in("provider_thread_index", batch),
        "load group names",
      );
      for (const r of rows) if (r.provider_thread_index) stored.set(r.provider_thread_index, r.group_name);
    }
    let renamed = 0;
    for (const [id, subject] of named) {
      const index = indexes.get(id)!;
      if (!stored.has(index) || stored.get(index) === subject) continue; // no conversation yet, or unchanged
      must(await db.from("threads").update({ group_name: subject }).eq("account_id", this.id).eq("provider_thread_index", index), "save group name");
      renamed++;
    }
    if (renamed > 0) log.info("whatsapp group names saved", { account: this.id, renamed });
  }

  private async onLidMapping(pairs: { lid: string; pn: string }[]) {
    // A history batch can carry thousands of pairs, so a few are saved at a time.
    await mapLimit(pairs, 4, async (pair) => {
      const phone = e164(pair.pn);
      if (!phone) return;
      const lid = jidNormalizedUser(pair.lid);
      const pn = jidNormalizedUser(pair.pn);
      this.pnByLid.set(lid, pn);
      if (this.mappedLids.get(lid) === pn) return;
      const keys = await keysFor(this.account.user_id);
      must(
        await db.rpc("whatsapp_map_lid", {
          p_account_id: this.id,
          p_lid_jid: await sealAddress(this.account.user_id, lid),
          p_pn_jid: await sealAddress(this.account.user_id, pn),
          p_phone: await sealAddress(this.account.user_id, phone),
          p_lid_index: await addressIndex(keys, lid),
          p_phone_index: await addressIndex(keys, phone),
          p_lid_chat_index: await chatIndex(keys, lid),
          p_pn_chat_index: await chatIndex(keys, pn),
        }),
        "map privacy id",
      );
      this.mappedLids.set(lid, pn);
    });
  }

  /** Chats read on your phone are marked read here too. No receipt is sent: the phone already did. */
  private async onChatUpdates(updates: Partial<Chat>[]) {
    const read = updates.filter((u) => u.id && u.unreadCount === 0).map((u) => jidNormalizedUser(u.id!));
    if (read.length === 0) return;
    const keys = await keysFor(this.account.user_id);
    const indexes = await Promise.all(read.map((jid) => chatIndex(keys, jid)));
    const changed = must(await db.rpc("whatsapp_mark_read", { p_account_id: this.id, p_chat_jids: read, p_chat_indexes: indexes }), "mark chats read");
    if (changed > 0) log.info("whatsapp chats read on phone", { account: this.id, threads: changed });
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  private async onHistory(batch: BaileysEventMap["messaging-history.set"]) {
    const n = ++this.historyBatches;
    await setAccountStatus(this.id, "syncing", "Importing the history from your phone.").catch(() => undefined);
    if (batch.lidPnMappings?.length) await this.onLidMapping(batch.lidPnMappings);
    if (batch.contacts.length) await this.onContacts(batch.contacts);
    this.rememberChats(batch.chats);

    const unreadByChat = new Map(batch.chats.filter((c) => c.id).map((c) => [jidNormalizedUser(c.id!), c.unreadCount ?? 0]));
    const sorted = [...batch.messages].sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0));
    const unread = unreadInHistory(
      sorted.map((m) => ({ id: m.key.id ?? "", chat: jidNormalizedUser(m.key.remoteJid ?? ""), fromMe: !!m.key.fromMe, at: Number(m.messageTimestamp ?? 0) })),
      unreadByChat,
    );

    // Stored a chunk per database call, in order. A chunk or message that still fails after retries is logged and skipped.
    let inserted = 0;
    let pending: Prepared[] = [];
    const flush = async () => {
      const chunk = pending;
      pending = [];
      if (chunk.length === 0) return;
      let results: Awaited<ReturnType<typeof ingestWhatsAppHistory.run>>;
      try {
        results = await retryStore(() => ingestWhatsAppHistory.run(this.id, chunk.map((p) => p.payload)), sleep);
      } catch (err) {
        // History is not redelivered, but one lost chunk must not abort the rest of the batch.
        log.warn("whatsapp history chunk failed", { account: this.id, code: errorCode(err), messages: chunk.length });
        return;
      }
      for (const [i, stored] of results.entries()) {
        if (isFailure(stored)) log.warn("whatsapp history message failed", { account: this.id, code: stored.code });
        else if (chunk[i].finish(stored)) inserted++;
      }
    };
    for (const msg of sorted) {
      try {
        const item = await this.prepare(msg, { live: false, unread: unread.has(msg.key.id ?? "") });
        if (!item) continue;
        if ("react" in item) {
          // A reaction is saved on the message it reacts to, so the messages before it are stored first.
          await flush();
          await item.react();
          continue;
        }
        pending.push(item);
        if (pending.length >= HISTORY_PER_CALL) await flush();
      } catch (err) {
        log.warn("whatsapp history message failed", { account: this.id, code: errorCode(err) });
      }
    }
    await flush();
    log.info("whatsapp history batch", {
      account: this.id,
      batch: n,
      chats: batch.chats.length,
      messages: batch.messages.length,
      inserted,
      progress: batch.progress ?? null,
    });
    await setAccountStatus(this.id, "connected").catch(() => undefined);
  }

  private async onMessages(messages: WAMessage[], live: boolean) {
    let inserted = 0;
    for (const msg of messages) {
      try {
        // A live message from someone else arrives unread; one from you (sent from your phone) is read.
        if (await this.store(msg, { live, unread: live && !msg.key.fromMe })) inserted++;
      } catch (err) {
        log.warn("whatsapp message failed", { account: this.id, code: errorCode(err) });
      }
    }
    if (inserted > 0) log.info("whatsapp messages stored", { account: this.id, inserted });
  }

  /** Stores one message, or the reaction it carries. Returns true when a new message was stored. */
  private async store(msg: WAMessage, opts: { live: boolean; unread: boolean }): Promise<boolean> {
    const item = await this.prepare(msg, opts);
    if (!item) return false;
    if ("react" in item) {
      await item.react();
      return false;
    }
    return item.finish(await retryStore(() => ingestWhatsApp(this.id, item.payload), sleep));
  }

  /**
   * Works out what to store for one message: the payload for public.ingest_whatsapp and what to do once
   * it is stored, or the reaction it carries, or null when it is not stored at all.
   */
  private async prepare(msg: WAMessage, opts: { live: boolean; unread: boolean }): Promise<Prepared | { react: () => Promise<void> } | null> {
    const key = msg.key;
    const remote = key.remoteJid;
    const id = key.id;
    if (!id || !remote || isJidBroadcast(remote) || isJidNewsletter(remote)) return null;
    const d = describe(msg.message);
    if (d.kind === "message" && d.unsupported) log.info("whatsapp unsupported message", { account: this.id, type: d.type });
    if (d.kind !== "message") return d.kind === "reaction" ? { react: () => this.react(key, d.targetId, d.emoji) } : null;

    const group = !!isJidGroup(remote);
    const fromMe = !!key.fromMe;
    const sentAt = new Date(Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000);

    let chatJid: string;
    let chatAlt: string | null = null;
    let sender: Person | null = null;
    const participants: Person[] = [];
    if (group) {
      chatJid = jidNormalizedUser(remote);
      if (!fromMe && key.participant) sender = await this.person(key.participant, key.participantAlt, msg.pushName);
    } else {
      const other = await this.person(remote, key.remoteJidAlt, fromMe ? null : msg.pushName);
      if (this.isMe(other)) return null; // "Message yourself" notes are not conversations
      chatJid = other.jid;
      chatAlt = other.lid && other.lid !== other.jid ? other.lid : null;
      participants.push(other);
      if (!fromMe) sender = other;
    }

    const body = nameMentions(d.text, d.mentions, (jid) => this.nameOf(jidNormalizedUser(jid)));
    // A quoted reply keeps what it quotes in provider_meta.quoted, which the app shows as a quote block.
    let quoted: { id: string; author: string; from_me: boolean; text: string } | null = null;
    if (d.quoted) {
      const author = d.quoted.participant ? await this.person(d.quoted.participant) : null;
      const mine = author ? this.isMe(author) : false;
      quoted = {
        id: d.quoted.id,
        from_me: mine,
        author: mine ? "You" : (author?.display_name ?? (group ? "Someone" : (participants[0]?.display_name ?? "Them"))),
        text: (await seal(this.account.user_id, FIELD.quote, d.quoted.text)) ?? "",
      };
    }
    const preview = group && sender ? `${sender.display_name}: ${d.preview}` : d.preview;

    const content = msg.message ? this.mediaContent(msg.message, d.media?.type) : null;
    const meta: StoredMeta & Record<string, unknown> = {
      chat: await sealAddress(this.account.user_id, remote),
      from_me: fromMe,
      participant: await sealAddress(this.account.user_id, key.participant ?? null),
      type: d.type,
      ...(d.media && content ? { media: mediaRef(d.media.type, content) } : {}),
      ...(opts.unread ? { receipt: "pending" } : {}),
      ...(quoted ? { quoted } : {}),
      ...(msg.reactions?.length ? await this.historyReactions(msg.reactions) : {}),
    };

    const chat = this.chats.get(chatJid) ?? (chatAlt ? this.chats.get(chatAlt) : undefined);
    const keys = await keysFor(this.account.user_id);
    const senderAddress = sender ? (sender.phone ?? sender.lid) : null;
    const payload = {
      provider_message_id: id,
      chat_jid: await sealAddress(this.account.user_id, chatJid),
      chat_alt_jid: await sealAddress(this.account.user_id, chatAlt),
      chat_index: await chatIndex(keys, chatJid),
      chat_alt_index: chatAlt ? await chatIndex(keys, chatAlt) : null,
      is_group: group,
      group_name: group ? (this.groups.get(chatJid)?.subject ?? chat?.name ?? null) : null,
      status: chat?.archived && !opts.live ? "archived" : "inbox",
      resurface: opts.live && !fromMe,
      sent_at: sentAt.toISOString(),
      direction: fromMe ? "outbound" : "inbound",
      is_read: !opts.unread,
      sender: sender ? await personJson(keys, sender, this.account.user_id) : null,
      sender_address: await sealAddress(this.account.user_id, senderAddress),
      sender_index: senderAddress ? await addressIndex(keys, senderAddress) : null,
      participants: await Promise.all(participants.map((p) => personJson(keys, p, this.account.user_id))),
      preview: await seal(this.account.user_id, FIELD.preview, oneLine(preview)),
      body_text: await seal(this.account.user_id, FIELD.body, body || null),
      provider_meta: meta as Json,
      attachments: d.media
        ? [{ filename: (await seal(this.account.user_id, FIELD.filename, d.media.filename))!, mime_type: d.media.mimeType, kind: d.media.kind, size_bytes: d.media.sizeBytes }]
        : [],
    } satisfies Record<string, Json>;

    const finish = (stored: WhatsAppStored): boolean => {
      if (stored.result !== "inserted" || !stored.message_id) return false;

      // Files: always for new messages, and for history from the same window email imports.
      const attachmentId = stored.attachment_ids?.[0];
      const recent = Date.now() - sentAt.getTime() < env.initialSyncDays * 86_400_000;
      // Stickers are small and are the message itself, so they are fetched at any age.
      const wanted = opts.live || recent || d.media?.type === "stickerMessage";
      if (d.media && attachmentId && wanted && (d.media.sizeBytes ?? 0) <= MAX_FILE_BYTES) {
        // The queued download keeps a small copy of what it needs, not the whole message.
        const file = meta.media ? messageFromRef({ remoteJid: remote, fromMe, id, participant: key.participant ?? undefined }, meta.media) : msg;
        const row = { messageId: stored.message_id, attachmentId, mimeType: d.media.mimeType, kind: d.media.kind, filename: d.media.filename, sizeBytes: d.media.sizeBytes };
        this.fileTries.set(attachmentId, 1);
        this.downloadLater(() => this.fetchFile(file, row));
      }
      return true;
    };
    return { payload, finish };
  }

  /** The media part of a message, after unwrapping disappearing, view once and captioned documents. */
  private mediaContent(message: proto.IMessage, type: string | undefined) {
    if (!type) return null;
    let content: proto.IMessage | null | undefined = message;
    for (let i = 0; i < 5 && content; i++) {
      const inner: proto.IMessage | null | undefined =
        content.ephemeralMessage?.message ??
        content.viewOnceMessage?.message ??
        content.viewOnceMessageV2?.message ??
        content.viewOnceMessageV2Extension?.message ??
        content.documentWithCaptionMessage?.message;
      if (!inner) break;
      content = inner;
    }
    return (content as Record<string, unknown> | null | undefined)?.[type] as Parameters<typeof mediaRef>[1] | null;
  }

  /**
   * Reactions a message arrived with, as provider_meta keeps them: reactions by who reacted, which is "me"
   * or the index of their number or privacy ID, and reactors, who each index is, encrypted.
   */
  private async historyReactions(list: proto.IReaction[]): Promise<{ reactions: Record<string, string>; reactors: Record<string, string> }> {
    const reactions: Record<string, string> = {};
    const reactors: Record<string, string> = {};
    for (const r of list) {
      if (!r.text) continue;
      if (r.key?.fromMe) {
        reactions[SELF] = r.text;
        continue;
      }
      const who = e164(r.key?.participant ?? r.key?.remoteJid) ?? jidNormalizedUser(r.key?.participant ?? r.key?.remoteJid ?? "");
      if (!who) continue;
      const key = await addressIndex(await keysFor(this.account.user_id), who);
      reactions[key] = r.text;
      reactors[key] = await sealAddress(this.account.user_id, who);
    }
    return { reactions, reactors };
  }

  /** A reaction is kept on the message it reacts to. `reactor` is the key of the reaction itself. */
  private async react(reactor: WAMessageKey, targetId: string, emoji: string) {
    let who = SELF;
    let sealed: string | null = null;
    if (!reactor.fromMe) {
      const jid = reactor.participant ?? reactor.remoteJid;
      if (!jid) return;
      const p = await this.person(jid, reactor.participantAlt ?? reactor.remoteJidAlt);
      const address = p.phone ?? p.lid ?? p.jid;
      who = await addressIndex(await keysFor(this.account.user_id), address);
      sealed = await sealAddress(this.account.user_id, address);
    }
    must(
      await db.rpc("whatsapp_react", { p_account_id: this.id, p_provider_message_id: targetId, p_sender: who, p_emoji: emoji, p_reactor: sealed ?? undefined }),
      "save reaction",
    );
  }

  private async onReactions(items: BaileysEventMap["messages.reaction"]) {
    for (const { key, reaction } of items) {
      if (!key.id || !reaction.key) continue;
      try {
        await this.react(reaction.key as WAMessageKey, key.id, reaction.text ?? "");
      } catch (err) {
        log.warn("whatsapp reaction failed", { account: this.id, code: errorCode(err) });
      }
    }
  }

  /** Edits and deletions made in WhatsApp, and the delivery and read ticks of messages you sent. */
  private async onUpdates(updates: BaileysEventMap["messages.update"]) {
    for (const { key, update } of updates) {
      if (!key.id) continue;
      try {
        if (update.messageStubType === WAMessageStubType.REVOKE) {
          const text = "This message was deleted.";
          const [body, preview] = await Promise.all([seal(this.account.user_id, FIELD.body, text), seal(this.account.user_id, FIELD.preview, text)]);
          must(
            await db.rpc("whatsapp_update_message", { p_account_id: this.id, p_provider_message_id: key.id, p_body: body!, p_preview: preview!, p_meta: { deleted: true } }),
            "save deletion",
          );
          continue;
        }
        if (key.fromMe && typeof update.status === "number") {
          // Baileys' statuses: 2 reached WhatsApp's server, 3 delivered, 4 read, 5 played (a voice note heard).
          const receipt = update.status >= 4 ? "read" : update.status === 3 ? "delivered" : update.status === 2 ? "sent" : null;
          if (receipt) must(await db.rpc("whatsapp_message_status", { p_account_id: this.id, p_provider_message_id: key.id, p_status: receipt }), "save receipt");
        }
        const edited = update.message?.editedMessage?.message;
        if (!edited) continue;
        // The new content, sometimes still inside the edit's protocol message.
        const d = describe(edited.protocolMessage?.editedMessage ?? edited);
        if (d.kind !== "message") continue;
        const text = d.text;
        must(
          await db.rpc("whatsapp_update_message", {
            p_account_id: this.id,
            p_provider_message_id: key.id,
            p_body: (await seal(this.account.user_id, FIELD.body, text))!,
            p_preview: (await seal(this.account.user_id, FIELD.preview, d.preview))!,
            p_meta: { edited: true },
          }),
          "save edit",
        );
      } catch (err) {
        log.warn("whatsapp update failed", { account: this.id, code: errorCode(err) });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  private downloadLater(work: () => Promise<void>) {
    this.media.background(work, (err) => {
      const status = (err as { output?: { statusCode?: number } }).output?.statusCode ?? null;
      log.warn("whatsapp file failed", { account: this.id, code: errorCode(err), status });
    });
  }

  private async fetchFile(msg: WAMessage, row: Omit<MediaRow, "userId" | "accountId">) {
    const sock = this.sock;
    if (!sock || !this.open) return;
    const saved = await saveMedia(sock, msg, { userId: this.account.user_id, accountId: this.id, ...row });
    if (saved) {
      this.fileTries.delete(row.attachmentId); // saved: never asked for again, so the count has no more use
      log.info("whatsapp file saved", { account: this.id, attachment: row.attachmentId });
    }
  }

  /** Files not saved yet (a failed download, or one the phone had to upload again), within the import window. */
  private async saveMissingMedia() {
    const since = new Date(Date.now() - env.initialSyncDays * 86_400_000).toISOString();
    // Files already past their tries are left out of the query, or they would fill the limit and starve the rest.
    const spent = [...this.fileTries].filter(([, tries]) => tries >= MAX_FILE_TRIES).map(([id]) => id).slice(-SPENT_IN_QUERY);
    const missing = () => {
      const query = db
        .from("attachments")
        .select("id, mime_type, kind, filename, size_bytes, message_id, messages!inner(account_id, provider_message_id, provider_meta, sent_at)")
        .is("storage_path", null)
        // A video kept as a link is not fetched; a file refused for a full seat is tried again once there is room.
        .or("not_kept.is.null,not_kept.eq.over_cap")
        .eq("messages.account_id", this.id)
        .lte("size_bytes", MAX_FILE_BYTES);
      return (spent.length > 0 ? query.not("id", "in", `(${spent.join(",")})`) : query).limit(100);
    };
    // Nothing to fetch with, nothing to ask the database for.
    if (!this.sock || !this.open) return;
    const recent = await missing().gte("messages.sent_at", since).then((r) => must(r, "load missing whatsapp files"));
    // Stickers are kept at any age, but a new one is inside the window above, so older ones are only looked
    // for when the recent pass found work, or once an hour after a pass that found none.
    let stickers: typeof recent = [];
    if (recent.length > 0 || Date.now() - this.stickersIdleSince >= STICKER_PASS_IDLE_MS) {
      stickers = await missing().eq("is_sticker", true).then((r) => must(r, "load missing whatsapp stickers"));
      this.stickersIdleSince = stickers.length === 0 ? Date.now() : 0;
    }
    if (recent.length === 0 && stickers.length === 0) return;
    const rows = await openAddresses(this.account.user_id, [...new Map([...recent, ...stickers].map((r) => [r.id, r])).values()]);
    for (const r of rows) {
      const tries = this.fileTries.get(r.id) ?? 0;
      if (tries >= MAX_FILE_TRIES) continue;
      this.fileTries.set(r.id, tries + 1);
      const meta = r.messages.provider_meta as unknown as StoredMeta;
      if (!meta?.media) continue;
      const key = { remoteJid: meta.chat, fromMe: meta.from_me, id: r.messages.provider_message_id, participant: meta.participant ?? undefined };
      const msg = messageFromRef(key, meta.media);
      this.downloadLater(() => this.fetchFile(msg, { messageId: r.message_id, attachmentId: r.id, mimeType: r.mime_type ?? "application/octet-stream", kind: r.kind, filename: r.filename, sizeBytes: r.size_bytes }));
    }
  }

  // ---------------------------------------------------------------------------
  // Sending and read receipts
  // ---------------------------------------------------------------------------

  /** Message text WhatsApp may ask for again when a recipient could not decrypt a reply the first time. */
  private async storedMessage(key: WAMessageKey): Promise<proto.IMessage | undefined> {
    if (!key.id) return undefined;
    const row = must(
      await db.from("messages").select("body_text").eq("account_id", this.id).eq("provider_message_id", key.id).eq("direction", "outbound").maybeSingle(),
      "load sent message",
    );
    const text = await open(this.account.user_id, FIELD.body, row?.body_text);
    return text ? { conversation: text } : undefined;
  }

  /**
   * Sends one queued reply over the linked device, then stores it so it shows in the conversation. A
   * reply with files goes as one message per file, the text as the first one's caption, and a voice
   * note recorded in the app is converted to the format WhatsApp needs first. Claimed first
   * (once its files have arrived), so it can never go out twice; while disconnected it waits in the queue.
   */
  async send(queuedRow: OutboxRow) {
    const sock = this.sock;
    if (!sock || !this.open) return; // not connected: picked up again on the next pass
    const row = await claimReady(queuedRow); // waits for its files, then claims it
    if (!row) return;
    if (this.sock !== sock || !this.open) {
      // The link dropped while the files arrived. Nothing has gone out, so this is safe to send again.
      await markFailed(row.id, "WhatsApp is not connected, so nothing was sent. Try again.");
      return;
    }
    let chatJid: string;
    try {
      const target = row.thread_id ? await this.replyTarget(row) : await this.newChatTarget(row, sock);
      if ("error" in target) {
        await markFailed(row.id, target.error);
        return;
      }
      chatJid = target.jid;
    } catch (err) {
      log.warn("whatsapp send target failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(row.id, "WhatsApp could not be reached, so nothing was sent. Try again.").catch(() => undefined);
      return;
    }

    let parts: AnyMessageContent[];
    try {
      const files = row.attachment_count > 0 ? await loadAttachmentFiles(row, "whatsapp") : [];
      if ("error" in files) {
        await markFailed(row.id, files.error);
        return;
      }
      const ready = await prepareVoiceNotes(files, { account: this.id, outbox: row.id });
      if ("error" in ready) {
        await markFailed(row.id, ready.error);
        return;
      }
      parts = outgoingMessages((await open(row.user_id, FIELD.body, row.body)) ?? "", ready);
    } catch (err) {
      log.warn("whatsapp attachments failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(row.id, "The attachments could not be read. Try again.").catch(() => undefined);
      return;
    }
    if (parts.length === 0) {
      await markFailed(row.id, "There is nothing to send.");
      return;
    }

    const sent: WAMessage[] = [];
    try {
      const quoted = row.thread_id && row.reply_to_message_id ? await this.quotable(row.reply_to_message_id, row.thread_id, chatJid) : undefined;
      for (const [i, part] of parts.entries()) {
        const message = await sock.sendMessage(chatJid, part, i === 0 && quoted ? { quoted } : undefined);
        if (!message?.key.id) throw Object.assign(new Error("no message id"), { code: "NO_ID" });
        sent.push(message);
      }
    } catch (err) {
      log.warn("whatsapp reply failed", { account: this.id, outbox: row.id, code: errorCode(err), sentParts: sent.length, parts: parts.length });
      await markFailed(
        row.id,
        sent.length > 0
          ? `Only ${sent.length} of ${parts.length} parts were sent. Check WhatsApp before sending the rest.`
          : "The message may not have been sent. Check WhatsApp before sending again.",
      ).catch(() => undefined);
      await this.storeSent(sent, row.id);
      return;
    }
    if (!(await settleSent(row.id, sent[0].key.id!))) log.warn("whatsapp reply sent but not recorded", { account: this.id, outbox: row.id });
    else log.info(row.thread_id ? "whatsapp reply sent" : "whatsapp new chat sent", { account: this.id, outbox: row.id, parts: sent.length });
    await this.storeSent(sent, row.id);
    if (!row.thread_id) await this.linkNewChat(row.id, sent[0].key.id!);
  }

  /** The chat a reply goes to: its conversation's, which must be a WhatsApp chat on this account and yours. */
  private async replyTarget(row: OutboxRow): Promise<{ jid: string } | { error: string }> {
    const thread = must(
      await db.from("threads").select("account_id, user_id, channel, provider_thread_id").eq("id", row.thread_id!).maybeSingle(),
      "load whatsapp thread",
    );
    await openAddresses(this.account.user_id, thread);
    // The chat's own person's reply, or a member of the shared inbox it is in (this account's, which they cannot replace).
    const via = thread ? replyFor(thread.user_id, row.user_id, thread.user_id !== row.user_id && (await onInboxList(row.thread_id!, row.user_id))) : "nobody";
    if (!thread || thread.account_id !== this.id || via === "nobody" || thread.channel !== "whatsapp") {
      return { error: "This message belongs to another account." };
    }
    return { jid: thread.provider_thread_id };
  }

  /**
   * The chat a new message starts: one number in E.164, checked with WhatsApp first so nothing is sent to
   * a number without an account. A chat that already exists with that number is simply continued.
   */
  private async newChatTarget(row: OutboxRow, sock: WASocket): Promise<{ jid: string } | { error: string }> {
    if (row.account_id !== this.id || row.user_id !== this.account.user_id) return { error: "This message belongs to another account." };
    const digits = newChatNumber(row.to_addresses);
    if (!digits) return { error: "Enter one phone number with its country code, like +44 7700 900123." };
    const [found] = (await sock.onWhatsApp(digits)) ?? [];
    if (!found?.exists) return { error: "This number is not on WhatsApp." };
    // WhatsApp may answer with the number's own JID or a privacy ID; a chat is addressed by the number.
    return { jid: isPnUser(found.jid) ? jidNormalizedUser(found.jid) : `${digits}@s.whatsapp.net` };
  }

  /** Points a sent new chat at its conversation, once stored, so the app can open it. */
  private async linkNewChat(outboxId: string, providerMessageId: string) {
    try {
      const stored = must(
        await db.from("messages").select("thread_id").eq("account_id", this.id).eq("provider_message_id", providerMessageId).maybeSingle(),
        "find new chat",
      );
      if (stored) await linkThread(outboxId, stored.thread_id);
      else log.warn("whatsapp new chat not stored yet", { account: this.id, outbox: outboxId });
    } catch (err) {
      log.warn("whatsapp link new chat failed", { account: this.id, outbox: outboxId, code: errorCode(err) });
    }
  }

  /** Stores what went out, so it shows in the conversation at once. Files are fetched back like any other. */
  private async storeSent(messages: WAMessage[], outboxId: string) {
    for (const message of messages) {
      await this.queue.run(async () => {
        await this.store(message, { live: true, unread: false });
      }).catch((err) => log.warn("store sent whatsapp failed", { account: this.id, outbox: outboxId, code: errorCode(err) }));
    }
  }

  /**
   * A 'read' action means you opened the chat in the app. Only then, and only with read receipts on in
   * Settings, does WhatsApp hear that you read the messages. A 'react' action sends your reaction (an
   * empty emoji removes it). Archive and unarchive are app-only here.
   */
  async applyAction(row: Tables<"mail_actions">) {
    const sock = this.sock;
    if (!sock || !this.open) throw new NotReady(); // not connected: back to queued, the next poll retries it
    try {
      if (row.action === "react" && row.message_id) {
        const target = must(
          await db.from("messages").select("provider_message_id, direction, provider_meta, thread_id, threads(provider_thread_id)").eq("id", row.message_id).eq("account_id", this.id).maybeSingle(),
          "load reaction target",
        );
        await openAddresses(this.account.user_id, target);
        if (!target || target.thread_id !== row.thread_id || !target.threads) throw Object.assign(new Error("no target"), { code: "NO_TARGET" });
        const meta = target.provider_meta as unknown as StoredMeta;
        const key = { remoteJid: target.threads.provider_thread_id, id: target.provider_message_id, fromMe: target.direction === "outbound", participant: meta.participant ?? undefined };
        await sock.sendMessage(target.threads.provider_thread_id, { react: { text: row.emoji ?? "", key } });
        must(await db.rpc("whatsapp_react", { p_account_id: this.id, p_provider_message_id: target.provider_message_id, p_sender: SELF, p_emoji: row.emoji ?? "" }), "save my reaction");
        log.info("whatsapp reaction sent", { account: this.id, action: row.id });
      }
      if (row.action === "read") {
        const pending = must(
          await db
            .from("messages")
            .select("id, provider_message_id, provider_meta")
            .eq("thread_id", row.thread_id)
            .eq("account_id", this.id)
            .eq("direction", "inbound")
            .eq("provider_meta->>receipt", "pending")
            .limit(500),
          "load unread whatsapp messages",
        );
        await openAddresses(this.account.user_id, pending);
        if (pending.length > 0) {
          const profile = must(await db.from("profiles").select("whatsapp_read_receipts").eq("user_id", row.user_id).maybeSingle(), "load profile");
          const on = profile?.whatsapp_read_receipts === true;
          if (on) {
            const keys = pending.map((m) => {
              const meta = m.provider_meta as unknown as StoredMeta;
              return { remoteJid: meta.chat, id: m.provider_message_id, participant: meta.participant ?? undefined, fromMe: false };
            });
            await sock.readMessages(keys);
          }
          must(
            await db.rpc("whatsapp_set_receipt", { p_account_id: this.id, p_message_ids: pending.map((m) => m.id), p_state: on ? "sent" : "skipped" }),
            "record receipts",
          );
          log.info("whatsapp read receipts", { account: this.id, messages: pending.length, sent: on });
        }
      }
      await finishAction(row.id);
    } catch (err) {
      log.warn("whatsapp action failed", { account: this.id, action: row.action, code: errorCode(err) });
      await finishAction(row.id, row.action === "react" ? "Could not send your reaction to WhatsApp." : "Could not tell WhatsApp you read this chat.");
    }
  }

  /** A stored message in this chat, in the shape Baileys needs to quote it in a reply. */
  private async quotable(messageId: string, threadId: string | null, chatJid: string): Promise<WAMessage | undefined> {
    const m = must(
      await db.from("messages").select("provider_message_id, direction, body_text, provider_meta, thread_id").eq("id", messageId).eq("account_id", this.id).maybeSingle(),
      "load quoted message",
    );
    await openAddresses(this.account.user_id, m);
    if (!m || m.thread_id !== threadId) return undefined;
    const meta = m.provider_meta as unknown as StoredMeta;
    return {
      key: { remoteJid: chatJid, id: m.provider_message_id, fromMe: m.direction === "outbound", participant: meta.participant ?? undefined },
      message: { conversation: (await open(this.account.user_id, FIELD.body, m.body_text)) ?? "" },
    };
  }

  /**
   * Profile pictures for people and groups in your chats, looked up one at a time with a pause between,
   * and again after a week. A picture from your own address book is never replaced.
   */
  private async syncPhotos(sock: WASocket) {
    if (this.photosRunning) return;
    this.photosRunning = true;
    try {
      const stale = new Date(Date.now() - PHOTO_STALE_MS).toISOString();
      const threads = await allRows(
        (from, to) =>
          db
            .from("threads")
            .select("id, is_group, provider_thread_id, avatar_updated_at, thread_participants(contact_id, contacts(avatar_source, avatar_updated_at))")
            .eq("account_id", this.id)
            .order("id")
            .range(from, to),
        "load chats for photos",
      ).then((rows) => openAddresses(this.account.user_id, rows));
      const due = (at: string | null) => !at || at < stale;
      const jobs: { jid: string; save: (bytes: Buffer | null) => Promise<boolean> }[] = [];
      const seen = new Set<string>();
      for (const t of threads) {
        if (t.is_group) {
          if (due(t.avatar_updated_at)) jobs.push({ jid: t.provider_thread_id, save: (b) => saveGroupPhoto(this.account.user_id, t.id, b) });
          continue;
        }
        const p = t.thread_participants[0];
        if (!p?.contacts || seen.has(p.contact_id)) continue;
        seen.add(p.contact_id);
        const source = p.contacts.avatar_source;
        if ((source === null || source === "whatsapp") && due(p.contacts.avatar_updated_at)) {
          const known = { avatar_source: source };
          jobs.push({ jid: t.provider_thread_id, save: (b) => saveContactPhoto(this.account.user_id, p.contact_id, "whatsapp", b, known) });
        }
      }

      let saved = 0;
      for (const job of jobs) {
        if (sock !== this.sock || !this.open || this.stopped) break;
        // No picture, or hidden by the person's privacy settings, comes back as an error or nothing.
        const url = await sock.profilePictureUrl(job.jid, "preview").catch(() => undefined);
        let bytes: Buffer | null = null;
        if (url) {
          const res = await fetch(url).catch(() => null);
          if (res?.ok) bytes = Buffer.from(await res.arrayBuffer());
        }
        if (await job.save(bytes)) saved++;
        await sleep(PHOTO_PAUSE_MS);
      }
      if (jobs.length) log.info("whatsapp photos checked", { account: this.id, checked: jobs.length, saved });
    } finally {
      this.photosRunning = false;
    }
  }

  // ---------------------------------------------------------------------------

  private background(step: () => Promise<void>) {
    this.queue.background(step, (err) => log.warn("whatsapp background step failed", { account: this.id, code: errorCode(err) }));
  }
}

const VERSION_TTL_MS = 6 * 60 * 60_000;
let cachedVersion: { at: number; value: Awaited<ReturnType<typeof fetchLatestWaWebVersion>> } | null = null;

/** WhatsApp Web's current version, asked for at most every few hours. Null when it cannot be fetched. */
async function latestWebVersion() {
  if (cachedVersion && Date.now() - cachedVersion.at < VERSION_TTL_MS) return cachedVersion.value;
  const value = await fetchLatestWaWebVersion().catch(() => null);
  if (value?.isLatest) cachedVersion = { at: Date.now(), value };
  return value;
}

/**
 * A person as public.whatsapp_contact takes them: their number and privacy ID as stored (encrypted once
 * addresses are), with the indexes it matches them on.
 */
async function personJson(keys: UserKeys, p: Pick<Person, "phone" | "lid" | "display_name" | "push_name">, userId: string) {
  return {
    phone: await sealAddress(userId, p.phone),
    lid: await sealAddress(userId, p.lid),
    phone_index: p.phone ? await addressIndex(keys, p.phone) : null,
    lid_index: p.lid ? await addressIndex(keys, p.lid) : null,
    display_name: p.display_name,
    push_name: p.push_name,
  };
}
