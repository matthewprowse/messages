// WhatsApp, as a linked device (the way WhatsApp Web works) through Baileys. Messages and the history the
// phone sends when the device links are stored like email; replies queued in the outbox go out over the
// link. Nothing is ever sent on its own: no "online", and read receipts only when you open a chat in the app with
// read receipts turned on in Settings. The one presence there is: "typing" for a moment before a reply you sent goes
// out, with a jittered gap between messages and daily limits (../whatsapp/send-rails.ts) so the link sends like a person.
//
// Memory and reads: the name, chat, group, privacy ID and download-count maps are size-bounded (least recently
// used first, ../whatsapp/bounded-map.ts) and re-derived on demand; groups are cleared on reconnect. The
// ten-minute missing-file catch-up asks the database nothing while the link is down or nothing is missing, and
// looks for old stickers only when the recent pass found work or once an hour.

import makeWASocket, {
  Browsers,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type BaileysEventMap,
  type Chat,
  type Contact,
  type GroupMetadata,
  type WAMessage,
  type WAMessageKey,
  type WACallEvent,
  type WASocket,
  type proto,
} from "baileys";
import type { Tables } from "@messages/db";
import { Backoff, SerialQueue, sleep } from "../backoff";
import { NotReady } from "../send/actions";
import { db, getSyncState, must, recordEvent, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { MAX_FILE_BYTES } from "../file-store";
import type { OutboxRow } from "../send/outbox";
import { isLinked, useDbAuthState, type DbAuthState } from "../whatsapp/auth-state";
import { silentLogger } from "../whatsapp/logger";
import { BoundedMap } from "../whatsapp/bounded-map";
import { messageFromRef, saveMedia, type MediaRow } from "../whatsapp/media";
import { describe, e164, formatPairingCode, nameMentions, pairingDigits } from "../whatsapp/normalize";
import { quietSignalLogs } from "../whatsapp/quiet-signal";
import { ingestWhatsApp, type WhatsAppStored } from "../whatsapp/ingest";
import { retryStore } from "../whatsapp/retry";
import { decideClose, noCloses } from "../whatsapp/close-policy";
import { ownsAccount } from "../shard";
import { applyWhatsAppAction } from "../whatsapp/actions";
import { isBusinessAccount } from "../whatsapp/business";
import { missedCallMessage } from "../whatsapp/calls";
import { saveLabelAssociation, saveLabels } from "../whatsapp/labels";
import { applyPollVote, voteOf } from "../whatsapp/poll-votes";
import { Pacer, railsFromEnv } from "../whatsapp/send-rails";
import { importHistory } from "../whatsapp/history";
import { missingMediaJobs } from "../whatsapp/missing-media";
import { People, MAX_LIDS } from "../whatsapp/people";
import { sendQueued } from "../whatsapp/send";
import { buildPayload, type Quoted } from "../whatsapp/message-payload";
import { markChatsRead, saveContactNames, saveGroupNames, saveLidMappings } from "../whatsapp/names";
import { syncPhotos } from "../whatsapp/photos";
import { SELF } from "../whatsapp/reactions";
import { applyUpdates } from "../whatsapp/updates";
import { latestWebVersion } from "../whatsapp/web-version";
import type { AccountCtx, Person, Prepared } from "../whatsapp/person";
import { FIELD } from "@messages/crypto/fields";
import { addressIndex } from "@messages/crypto/addresses";
import { keysFor, open, seal, sealAddress } from "../vault";

quietSignalLogs();

const MEDIA_CATCH_UP_MS = 10 * 60_000;
// Memory bounds for the per-account Maps below (least recently used goes first). All of it is worked out again
// from the database or the socket when needed, so a dropped entry costs a lookup, not correctness.
const MAX_CHATS = 5_000;
const MAX_GROUPS = 2_000;
const MAX_FILE_TRY_ENTRIES = 5_000;
const TOUCH_MS = 60_000;
const NAMES_RESYNC_DELAY_MS = 30_000;
const PHOTO_REFRESH_MS = 24 * 60 * 60_000; // look for new profile pictures once a day

type Outcome = "reconnect" | "restart" | "stop";

export class WhatsAppConnector {
  private sock: WASocket | null = null;
  private auth: DbAuthState | null = null;
  private open = false;
  private stopped = false;
  private readonly backoff = new Backoff();
  /** Closes of each troublesome kind since the last open, and the least wait before the next reconnect (close-policy.ts). */
  private closes = noCloses();
  private minDelayMs = 0;
  /** Message storage runs in order, one at a time, so history and live messages never race. */
  private readonly queue = new SerialQueue();
  /** File downloads, one at a time, apart from message storage so a slow file never holds up messages. */
  private readonly media = new SerialQueue();
  private timers: NodeJS.Timeout[] = [];
  /** Names, privacy ID mappings and "is this me" (../whatsapp/people.ts). */
  private readonly people = new People(() => this.sock);
  private groups = new BoundedMap<string, GroupMetadata>(MAX_GROUPS);
  private chats = new BoundedMap<string, { name?: string | null; archived?: boolean | null }>(MAX_CHATS);
  /** Download attempts per file this run, so one that cannot be fetched is not retried forever. */
  private fileTries = new BoundedMap<string, number>(MAX_FILE_TRY_ENTRIES);
  /** Privacy IDs already mapped in the database this run, so repeated history batches skip the write. */
  private mappedLids = new BoundedMap<string, string>(MAX_LIDS);
  private historyBatches = 0;
  /** Sends go out one at a time, so the gap between messages and the daily count are kept per account. */
  private readonly sendQueue = new SerialQueue();
  private readonly pace = (() => {
    const rails = railsFromEnv(process.env);
    return { rails, pacer: new Pacer(rails) };
  })();
  /** Whether this link is a WhatsApp Business account (labels sync only then); null until asked or when WhatsApp could not say. */
  private business: boolean | null = null;
  private photosRunning = false;
  private lastMediaCatchUp = 0;
  /** When the sticker pass of the media catch-up last found nothing missing; it then waits STICKER_PASS_IDLE_MS. */
  private readonly stickers = { idleSince: 0 };

  constructor(private readonly account: AccountRow) {}

  private get ctx(): AccountCtx {
    return { accountId: this.account.id, userId: this.account.user_id };
  }

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
      const delay = Math.max(this.backoff.next(), this.minDelayMs);
      this.minDelayMs = 0;
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
    for (const [lid, pn] of this.people.pnByLid) if (!pn) this.people.pnByLid.delete(lid);
    // Both are rebuilt by the link on open (group list) or by the next history batch (database mapping writes).
    this.groups.clear();
    this.mappedLids.clear();
    this.business = null; // asked again for the new link

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
      // WAM telemetry has no switch in Baileys: it only goes out if sock.sendWAMBuffer is called, which we never do (README, "Updating Baileys").
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
          const labelEdit = events["labels.edit"];
          const labelChat = events["labels.association"];
          const calls = events["call"];
          if (history) this.background(() => this.onHistory(history));
          if (upsert) this.background(() => this.onMessages(upsert.messages, upsert.type === "notify"));
          if (updates) this.background(() => applyUpdates(this.ctx, updates));
          if (reactions) this.background(() => this.onReactions(reactions));
          if (newContacts) this.background(() => this.onContacts(newContacts));
          if (contactUpdates) this.background(() => this.onContacts(contactUpdates));
          if (events["chats.upsert"]) this.rememberChats(events["chats.upsert"]);
          if (chatUpdates) this.background(() => markChatsRead(this.ctx, chatUpdates));
          if (newGroups) this.background(() => this.onGroups(newGroups));
          if (groupUpdates) this.background(() => this.onGroups(groupUpdates));
          if (lidMapping) this.background(() => this.onLidMapping([lidMapping]));
          if (labelEdit) this.background(() => this.onLabel(labelEdit));
          if (labelChat) this.background(() => this.onLabelChat(labelChat));
          if (calls) this.background(() => this.onCalls(calls));
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
    this.closes = noCloses();
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

    const { action, counts } = decideClose({ status, wasLinked, ownsAccount: ownsAccount(this.id), counts: this.closes });
    this.closes = counts;
    if (action.kind === "restart") return "restart";
    if (action.kind === "logged-out") {
      // The phone removed this device, or the link lapsed because the phone was offline for 14 days.
      // The session is useless now, so it is wiped and a new link starts from a fresh QR code.
      await this.auth?.wipe().catch((err) => log.warn("whatsapp wipe failed", { account: this.id, code: errorCode(err) }));
      await this.linkFailed(action.detail);
      log.warn("whatsapp logged out", { account: this.id });
      return "stop";
    }
    if (action.kind === "link-expired") {
      await this.linkFailed(action.detail);
      return "stop";
    }
    if (action.kind === "yield") {
      // Another worker owns this account now and its socket replaced ours. Stopping leaves the link and status to it.
      log.info("whatsapp yielded to the owning worker", { account: this.id });
      return "stop";
    }
    // A refusal, a replaced link or a damaged session is retried slowly and never wipes: wiping loses the whole link.
    this.minDelayMs = action.minDelayMs;
    if (action.minDelayMs > 0) log.warn("whatsapp reconnect delayed", { account: this.id, status: status ?? null, inMs: action.minDelayMs, attention: action.attention !== null });
    if (action.attention) await setAccountStatus(this.id, "error", action.attention).catch(() => undefined);
    else await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
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

  private rememberChats(chats: Chat[]) {
    for (const c of chats) if (c.id) this.chats.set(jidNormalizedUser(c.id), { name: c.name, archived: c.archived });
  }

  private onContacts(contacts: Partial<Contact>[]) {
    return saveContactNames(this.ctx, contacts, { saved: this.people.savedNames, push: this.people.pushNames });
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

  /** Keeps group metadata for sending, and stores group names that changed (./names.ts). */
  private async onGroups(groups: Partial<GroupMetadata>[]) {
    const named = new Map<string, string>();
    for (const g of groups) {
      if (!g.id) continue;
      if (g.subject !== undefined && "participants" in g) this.groups.set(g.id, g as GroupMetadata);
      if (g.subject) named.set(g.id, g.subject);
    }
    await saveGroupNames(this.ctx, named);
  }

  private onLidMapping(pairs: { lid: string; pn: string }[]) {
    return saveLidMappings(this.ctx, pairs, { pnByLid: this.people.pnByLid, mappedLids: this.mappedLids });
  }

  private onHistory(batch: BaileysEventMap["messaging-history.set"]) {
    return importHistory(
      {
        accountId: this.id,
        onLidMapping: (pairs) => this.onLidMapping(pairs),
        onContacts: (contacts) => this.onContacts(contacts),
        rememberChats: (chats) => this.rememberChats(chats),
        prepare: (msg, opts) => this.prepare(msg, opts),
      },
      batch,
      ++this.historyBatches,
    );
  }

  private async onMessages(messages: WAMessage[], live: boolean) {
    let inserted = 0;
    for (const msg of messages) {
      try {
        if (voteOf(msg)) {
          await this.onPollVote(msg);
          continue;
        }
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
      if (!fromMe && key.participant) sender = await this.people.person(key.participant, key.participantAlt, msg.pushName);
    } else {
      const other = await this.people.person(remote, key.remoteJidAlt, fromMe ? null : msg.pushName);
      if (this.people.isMe(other)) return null; // "Message yourself" notes are not conversations
      chatJid = other.jid;
      chatAlt = other.lid && other.lid !== other.jid ? other.lid : null;
      participants.push(other);
      if (!fromMe) sender = other;
    }

    const body = nameMentions(d.text, d.mentions, (jid) => this.people.nameOf(jidNormalizedUser(jid)));
    // A quoted reply keeps what it quotes in provider_meta.quoted, which the app shows as a quote block.
    let quoted: Quoted | null = null;
    if (d.quoted) {
      const author = d.quoted.participant ? await this.people.person(d.quoted.participant) : null;
      const mine = author ? this.people.isMe(author) : false;
      quoted = {
        id: d.quoted.id,
        from_me: mine,
        author: mine ? "You" : (author?.display_name ?? (group ? "Someone" : (participants[0]?.display_name ?? "Them"))),
        text: (await seal(this.account.user_id, FIELD.quote, d.quoted.text)) ?? "",
      };
    }
    const chat = () => ({ chat: this.chats.get(chatJid) ?? (chatAlt ? this.chats.get(chatAlt) : undefined), groupSubject: this.groups.get(chatJid)?.subject });
    const { payload, meta } = await buildPayload(this.ctx, { msg, key, remote, id, d, group, fromMe, sentAt, chatJid, chatAlt, sender, participants, quoted, body, live: opts.live, unread: opts.unread, known: chat });

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

  /** A reaction is kept on the message it reacts to. `reactor` is the key of the reaction itself. */
  private async react(reactor: WAMessageKey, targetId: string, emoji: string) {
    const found = await this.whoIs(reactor);
    if (!found) return;
    const { who, sealed } = found;
    must(
      await db.rpc("whatsapp_react", { p_account_id: this.id, p_provider_message_id: targetId, p_sender: who, p_emoji: emoji, p_reactor: sealed ?? undefined }),
      "save reaction",
    );
  }

  /** Who a reaction or vote is from: "me", or a blind index of their number, with the sealed number for a reaction. Null when the key names nobody. */
  private async whoIs(key: WAMessageKey): Promise<{ who: string; sealed: string | null } | null> {
    if (key.fromMe) return { who: SELF, sealed: null };
    const jid = key.participant ?? key.remoteJid;
    if (!jid) return null;
    const p = await this.people.person(jid, key.participantAlt ?? key.remoteJidAlt);
    const address = p.phone ?? p.lid ?? p.jid;
    return { who: await addressIndex(await keysFor(this.account.user_id), address), sealed: await sealAddress(this.account.user_id, address) };
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

  /** A vote on a poll is kept on the poll (../whatsapp/poll-votes.ts). One that cannot be read is dropped, not retried. */
  private async onPollVote(msg: WAMessage) {
    const me = this.sock?.user?.id;
    if (!me) return;
    await applyPollVote(this.ctx, me, msg, async (key) => {
      const found = await this.whoIs(key);
      if (!found) throw new Error("vote from nobody");
      return found.who;
    });
  }

  /** Whether labels are worth saving: true for a Business account. Not knowing (a failed lookup) lets them through, as only Business links get label events. */
  private async isBusiness(): Promise<boolean> {
    if (this.business === null && this.sock) this.business = await isBusinessAccount(this.sock);
    return this.business !== false;
  }

  private async onLabel(label: BaileysEventMap["labels.edit"]) {
    if (await this.isBusiness()) await saveLabels(this.ctx, [label]);
  }

  private async onLabelChat(event: BaileysEventMap["labels.association"]) {
    if (!(await this.isBusiness())) return;
    // A chat may be known by a phone number or by a privacy ID: try the other one too.
    const chat = event.association.chatId;
    const alt = chat.endsWith("@lid") ? (this.people.pnByLid.get(chat) ?? null) : null;
    await saveLabelAssociation(this.ctx, event, alt);
  }

  /** A call that rang out unanswered is stored as a missed call line (../whatsapp/calls.ts). */
  private async onCalls(calls: WACallEvent[]) {
    const me = this.sock?.user;
    const mine = new Set([me?.id, me?.lid].filter((j): j is string => !!j).map((j) => jidNormalizedUser(j)));
    for (const call of calls) {
      const msg = missedCallMessage(call, mine.has(jidNormalizedUser(call.from)));
      if (!msg) continue;
      try {
        await this.store(msg, { live: true, unread: true });
      } catch (err) {
        log.warn("whatsapp call failed", { account: this.id, code: errorCode(err) });
      }
    }
  }

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
    // Nothing to fetch with, nothing to ask the database for.
    if (!this.sock || !this.open) return;
    for (const { msg, row } of await missingMediaJobs(this.ctx, this.fileTries, this.stickers)) this.downloadLater(() => this.fetchFile(msg, row));
  }

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

  /** Sends one queued reply or new message over the link (./send.ts). While disconnected it waits in the queue. */
  async send(queuedRow: OutboxRow) {
    const sock = this.sock;
    if (!sock || !this.open) return; // not connected: picked up again on the next pass
    // One at a time per account: the gap between messages and the daily count only mean something in order.
    await this.sendQueue.run(() => sendQueued(this.ctx, sock, queuedRow, () => this.sock === sock && this.open, (sent, outboxId) => this.storeSent(sent, outboxId), this.pace));
  }

  /** Stores what went out, so it shows in the conversation at once. Files are fetched back like any other. */
  private async storeSent(messages: WAMessage[], outboxId: string) {
    for (const message of messages) {
      await this.queue.run(async () => {
        await this.store(message, { live: true, unread: false });
      }).catch((err) => log.warn("store sent whatsapp failed", { account: this.id, outbox: outboxId, code: errorCode(err) }));
    }
  }

  /** An app action on a chat (a reaction, read receipts): see ./actions.ts. Not connected means back to queued. */
  async applyAction(row: Tables<"mail_actions">) {
    const sock = this.sock;
    if (!sock || !this.open) throw new NotReady(); // not connected: back to queued, the next poll retries it
    await applyWhatsAppAction(this.ctx, sock, row);
  }

  /** Profile pictures: one lookup at a time (./photos.ts). A second pass is not started while one runs. */
  private async syncPhotos(sock: WASocket) {
    if (this.photosRunning) return;
    this.photosRunning = true;
    try {
      await syncPhotos(this.ctx, sock, () => sock === this.sock && this.open && !this.stopped);
    } finally {
      this.photosRunning = false;
    }
  }

  // ---------------------------------------------------------------------------

  private background(step: () => Promise<void>) {
    this.queue.background(step, (err) => log.warn("whatsapp background step failed", { account: this.id, code: errorCode(err) }));
  }
}
