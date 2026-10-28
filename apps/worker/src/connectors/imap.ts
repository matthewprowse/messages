import { ImapFlow, ImapFlowErrorCode } from "imapflow";
import nodemailer from "nodemailer";
import { Backoff, SerialQueue, sleep } from "../backoff";
import { allRows, db, getSyncState, loadCredentials, must, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { chunks, mapLimit, push } from "../util";
import { parseEmail, type NormalizedEmail } from "../ingest/normalize-email";
import { applyReadState, storeEmail, storeEmails, type FolderRole } from "../ingest/store-email";
import { isFailure } from "../ingest/batch-rpc";
import { sideFolderDue, type FolderCheck, type FolderStatus } from "../ingest/folder-status";
import { saveFilesQuietly } from "../ingest/attachment-files";
import { BackoffMissingFiles } from "../missing-files";
import { claimReady, composeOutgoing, freshAccount, linkNewEmails, linkThread, markFailed, settleSent, type OutboxRow, type SendAccount } from "../send/outbox";
import { normAddresses } from "../send/from-address";
import { carryOutUnsubscribe, type MailtoUnsubscribe } from "../send/unsubscribe-flow";
import type { Json, Tables } from "@messages/db";
import { imapMove, imapThreadPlace, type FolderPaths } from "../ingest/imap-place";
import { undoesNotJunk } from "../ingest/junk-undo";
import { finishAction } from "../send/actions";
import { pickFolders } from "../ingest/imap-folders";
import { sealAddress } from "../vault";
import type { ImapCredentials, MailCredentials, MailService } from "./mail-service";

// Any IMAP and SMTP mailbox: iCloud+ Mail (./icloud.ts), and mail on your own domain at any host (Afrihost,
// xneelo, cPanel and Dovecot servers, Yahoo, Fastmail, Zoho). IMAP to sync both ways, SMTP to send replies and
// unsubscribe emails. Read, unread, archive, delete and junk in the app are applied to the server (delete moves
// mail to Trash, never deletes it for good), and mail moved or deleted on another device leaves the app's
// inbox. Trash and Junk are never imported; they are only looked in for mail that left the Inbox. What differs
// from one service to the next, where its servers are and how it is named, is in ./mail-service.ts.

interface Folder {
  path: string;
  role: FolderRole;
}

const SIDE_FOLDER_POLL_MS = 60_000; // every folder is checked each minute (the others by STATUS); the Inbox is also live through IDLE
const CHECKPOINT_EVERY = 25; // messages stored per database call, then progress saved, so a restart resumes, not repeats
const LOCATE_AT_ONCE = 25; // Message-IDs looked up in one search of Trash or Junk
const RECONCILE_EVERY_TICKS = 5; // the Inbox is compared with the app every 5 minutes; expunge events cover quick changes
const FILES_EVERY_TICKS = 10;
const WRITE_AT_ONCE = 6; // row updates in flight together
const THREADS_AT_ONCE = 100; // thread ids in one .in() filter, to keep the request URL short

/** UIDs as an IMAP sequence set, runs written as ranges ("1:4,9"), so a big Inbox is a short command. */
export function uidSet(uids: number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}:${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(",");
}

const IMAP_CODES = new Set<string>(Object.values(ImapFlowErrorCode));

/** Whether a failure came from the IMAP connection (an ImapFlow code, or a NO or BAD reply) rather than the database. */
function isImapError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; responseStatus?: unknown };
  if (e.responseStatus !== undefined) return true;
  return typeof e.code === "string" && (IMAP_CODES.has(e.code) || e.code.startsWith("ParserError"));
}

export class ImapConnector<C extends MailCredentials = ImapCredentials> {
  private client: ImapFlow | null = null;
  private stopped = false;
  private readonly backoff = new Backoff();
  /** IMAP commands must not overlap, so every step runs through one queue. */
  private readonly queue = new SerialQueue();
  private pollTimer: NodeJS.Timeout | null = null;
  private selfAddresses = new Set<string>();
  private creds: C | null = null;
  private folders: Folder[] = [];
  /** Archive, Trash and Junk on this server, where it has them. */
  private paths: FolderPaths = {};
  /** Attachments with no stored file yet, a page per catch-up pass. One that cannot be saved is not retried every pass. */
  private readonly missingFiles: BackoffMissingFiles;
  /**
   * Each folder's sync state as last saved. This connector is the only writer, so it is read from the
   * database once a session and kept up to date on every save.
   */
  private readonly syncStates = new Map<string, { uid_validity: number | null; last_uid: number | null } | null>();
  /** Each folder other than the Inbox: its STATUS just before its last sync this session, and when that was. */
  private readonly sideChecks = new Map<string, FolderCheck>();

  constructor(
    private readonly account: AccountRow,
    private readonly service: MailService<C>,
  ) {
    this.missingFiles = new BackoffMissingFiles(account.id);
  }

  get id() {
    return this.account.id;
  }

  start() {
    void this.run();
  }

  async stop() {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.client?.logout().catch(() => undefined);
  }

  private async run() {
    while (!this.stopped) {
      try {
        await this.session();
      } catch (err) {
        if (this.stopped) break;
        if ((err as { authenticationFailed?: boolean }).authenticationFailed) {
          // Retrying a rejected password risks the provider locking the account. Wait for new credentials instead.
          log.error(`${this.service.tag} sign-in rejected`, { account: this.id });
          await setAccountStatus(this.id, "error", this.creds ? this.service.rejected(this.creds) : `${this.service.name} rejected the ${this.service.password}. Reconnect in Settings.`);
          return;
        }
        log.warn(`${this.service.tag} session failed`, { account: this.id, code: errorCode(err) });
        await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
      }
      if (this.stopped) break;
      const delay = this.backoff.next();
      log.info(`${this.service.tag} reconnecting`, { account: this.id, inMs: delay });
      await sleep(delay);
    }
  }

  /** One connected session: sync everything, then stay live until the connection drops. */
  private async session() {
    await setAccountStatus(this.id, "connecting");
    const creds = await loadCredentials<C>(this.id);
    this.creds = creds;
    this.syncStates.clear();
    this.sideChecks.clear();
    await this.refreshSelf(creds, { seed: true });

    const client = new ImapFlow({
      ...(await this.service.imap(creds)),
      auth: { user: creds.username, pass: creds.password },
      logger: false, // its debug logs include message content
      maxIdleTime: 5 * 60_000,
    });
    this.client = client;
    this.queue.reset();
    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    client.on("error", (err: unknown) => log.warn(`${this.service.tag} connection error`, { account: this.id, code: errorCode(err) }));

    // Whatever ends the session, the timer stops and the connection closes, so run() never leaves one open.
    try {
      await client.connect();
      this.backoff.reset();

      const folders = await this.discoverFolders(client);
      this.folders = folders;
      const inbox = folders.find((f) => f.role === "inbox")!;
      const sideFolders = folders.filter((f) => f.role !== "inbox");
      log.info(`${this.service.tag} connected`, { account: this.id, folders: folders.length });

      // Catch up on everything since the last session (or the first 30 days).
      await setAccountStatus(this.id, "syncing");
      for (const folder of folders) {
        await this.queue.run(() => (folder.role === "inbox" ? this.syncFolder(client, folder) : this.pollSideFolder(client, folder, true)));
      }
      await this.queue.run(() => this.selectInbox(client));
      await setAccountStatus(this.id, "connected");
      this.background(() => this.saveMissingFiles(client));

      // Live: new Inbox mail arrives through IDLE; read/unread changes arrive as flag updates.
      client.on("exists", (event: { path: string }) => {
        if (event.path === inbox.path) this.background(() => this.syncFolder(client, inbox));
      });
      client.on("expunge", (event: { path: string }) => {
        if (event.path === inbox.path) this.background(() => this.reconcileInbox(client));
      });
      client.on("flags", (event: { path: string; uid?: number; flags: Set<string> }) => {
        if (event.uid === undefined) return;
        const uid = event.uid;
        this.background(() => applyReadState(this.account, event.path, uid, event.flags.has("\\Seen")));
      });
      let ticking = false;
      let ticks = 0;
      this.pollTimer = setInterval(() => {
        // A slow server can take more than a minute; skip this tick rather than pile work up behind the last one.
        if (ticking) return;
        ticking = true;
        const tick = ticks++;
        // Other folders are asked for their STATUS, which keeps the Inbox selected; only a changed one is opened.
        for (const folder of sideFolders) this.background(() => this.pollSideFolder(client, folder));
        // IDLE occasionally misses an arrival, so the Inbox is checked too. It is cheap when nothing is new,
        // and it opens the Inbox again if a folder above was synced.
        this.background(() => this.syncFolder(client, inbox));
        // Files that failed before are rarely ready a minute later: look again every ten minutes.
        if (tick % FILES_EVERY_TICKS === 0) this.background(() => this.saveMissingFiles(client));
        if (tick % RECONCILE_EVERY_TICKS === 0) this.background(() => this.reconcileInbox(client));
        this.background(() => this.selectInbox(client));
        this.background(() => touchAccount(this.id));
        this.background(() => this.linkSent());
        // Queued last, so it runs once every step above has finished or failed.
        this.queue.background(
          async () => {
            ticking = false;
          },
          () => undefined,
        );
        // Send addresses edited in the app count as you from the next minute.
        void this.refreshSelf(creds).catch((err) => log.warn(`${this.service.tag} send addresses failed`, { account: this.id, code: errorCode(err) }));
      }, SIDE_FOLDER_POLL_MS);

      await closed;
    } finally {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
      client.close();
    }
    if (!this.stopped) throw Object.assign(new Error("connection closed"), { code: "CONNECTION_CLOSED" });
  }

  /**
   * Every address that is you: the account address, the sign-in name, credential aliases and the send
   * addresses listed in the app. The first session fills an empty list from the aliases and the address.
   * A caller that has just loaded the account passes it in, so it is not read twice.
   */
  private async refreshSelf(creds: C, opts: { seed?: boolean; account?: SendAccount } = {}): Promise<Set<string>> {
    const account = opts.account ?? (await freshAccount(this.id));
    let sendAddresses = account.send_addresses;
    if (opts.seed && sendAddresses.length === 0) {
      sendAddresses = [...new Set(normAddresses([account.address, ...(creds.aliases ?? [])]))];
      // Only while still empty, so a list saved in the app meanwhile is kept.
      must(
        await db
          .from("accounts")
          .update({ send_addresses: await Promise.all(sendAddresses.map((a) => sealAddress(account.user_id, a))) })
          .eq("id", this.id)
          .filter("send_addresses", "eq", "{}"),
        "seed send addresses",
      );
    }
    this.selfAddresses = new Set(normAddresses([account.address, creds.username, ...(creds.aliases ?? []), ...sendAddresses]));
    return this.selfAddresses;
  }

  private async discoverFolders(client: ImapFlow): Promise<Folder[]> {
    const { sent, archive, trash, junk } = pickFolders(await client.list());
    const folders: Folder[] = [{ path: "INBOX", role: "inbox" }];
    if (sent) folders.push({ path: sent, role: "sent" });
    if (archive) folders.push({ path: archive, role: "archive" });
    // Not synced: deleted and junk mail stays out of the app. Moves and lookups use them.
    this.paths = { archive, trash, junk };
    return folders;
  }

  private async selectInbox(client: ImapFlow) {
    // Returning to the Inbox after checking other folders keeps IDLE watching the right place.
    if (client.mailbox && client.mailbox.path === "INBOX") return;
    await client.mailboxOpen("INBOX");
  }

  /** Imports anything in this folder newer than where the last sync stopped. */
  private async syncFolder(client: ImapFlow, folder: Folder) {
    const lock = await client.getMailboxLock(folder.path);
    try {
      const box = client.mailbox;
      if (!box) return;
      const uidValidity = Number(box.uidValidity);
      const newestUid = box.uidNext - 1;
      const state = await this.folderState(folder.path);

      // A changed UIDVALIDITY means the server renumbered the folder, so start it again.
      const fresh = !state || state.uid_validity !== uidValidity || state.last_uid === null;
      let range: number[] | string;
      if (fresh) {
        const since = new Date(Date.now() - env.initialSyncDays * 86_400_000);
        const found = await client.search({ since }, { uid: true });
        if (!found || found.length === 0) {
          await this.saveFolderState(folder.path, uidValidity, newestUid);
          return;
        }
        range = found;
      } else {
        // Ask the server which messages are newer than the last one stored. The cached UIDNEXT is not
        // enough: when IDLE reports new mail in the folder that is already open, imapflow updates the
        // message count but not UIDNEXT, so trusting it left new mail waiting for the next minute's poll.
        const newer = ((await client.search({ uid: `${state.last_uid! + 1}:*` }, { uid: true })) || []).filter((uid) => uid > state.last_uid!);
        if (newer.length === 0) return;
        range = newer;
      }

      const floor = fresh ? 0 : state!.last_uid!;
      let lastUid = floor; // progress: every message up to here is stored
      let savedUid = floor;
      let inserted = 0;
      let failed = 0;
      let failure: string | null = null; // the first message that could not be stored: progress stops before it
      const movedOut = new Set<string>(); // known mail found outside the Inbox: moved on another device
      let seenCount = 0;
      let pending: { uid: number; mail: NormalizedEmail; seen: boolean }[] = [];

      // Stores what has been fetched so far in one call (a first sync), or alone (new mail), in order.
      const flush = async () => {
        const batch = pending;
        pending = [];
        if (batch.length === 0) return;
        const results = await storeEmails(
          this.account,
          batch.map((m) => ({
            mail: m.mail,
            ctx: { role: folder.role, meta: { folder: folder.path, uid: m.uid, uid_validity: uidValidity }, seen: m.seen, selfAddresses: this.selfAddresses },
          })),
        );
        for (const [i, stored] of results.entries()) {
          const { uid, mail } = batch[i];
          if (isFailure(stored)) {
            failed++;
            failure ??= stored.code;
            continue;
          }
          // Mail moved back into the Inbox on another device brings its conversation back too.
          if (stored.result === "updated" && folder.role === "inbox" && stored.threadId) {
            must(await db.from("threads").update({ status: "inbox" }).eq("id", stored.threadId).in("status", ["archived", "trash"]), "restore thread");
          }
          if (stored.result === "updated" && folder.role === "archive" && stored.threadId) movedOut.add(stored.threadId);
          if (stored.result === "inserted") {
            inserted++;
            if (stored.messageId) await saveFilesQuietly(this.id, this.account.user_id, stored.messageId, mail.attachments);
          }
          if (failure === null) lastUid = Math.max(lastUid, uid);
        }
      };

      for await (const msg of client.fetch(range, { uid: true, flags: true, source: true }, { uid: true })) {
        // "N:*" always returns the newest message, even when it is older than N.
        if (msg.uid <= floor || !msg.source) continue;
        const mail = await parseEmail(msg.source, `${folder.path}:${uidValidity}:${msg.uid}`);
        pending.push({ uid: msg.uid, mail, seen: msg.flags?.has("\\Seen") ?? false });
        seenCount++;
        if (pending.length >= CHECKPOINT_EVERY) {
          await flush();
          if (lastUid > savedUid) await this.saveFolderState(folder.path, uidValidity, (savedUid = lastUid));
        }
      }
      await flush();

      // After a failure, progress stops before the message that failed, so the next sync tries it again.
      // A first sync that stored nothing saves nothing, so it stays a first sync.
      if (failure === null) await this.saveFolderState(folder.path, uidValidity, Math.max(lastUid, fresh ? newestUid : lastUid));
      else if (lastUid > savedUid) await this.saveFolderState(folder.path, uidValidity, lastUid);
      if (movedOut.size) await this.placeThreads([...movedOut], true);
      if (seenCount > 0) log.info(`${this.service.tag} folder synced`, { account: this.id, role: folder.role, processed: seenCount, inserted, failed });
      if (failure !== null) throw Object.assign(new Error("message not stored"), { code: failure });
    } finally {
      lock.release();
    }
  }

  /**
   * Checks a folder other than the Inbox with STATUS, which leaves the Inbox selected so IDLE keeps
   * watching it, and opens and syncs the folder only when UIDNEXT, UIDVALIDITY or its message count
   * changed, or at least every ten minutes regardless. force: sync now, still recording the STATUS first
   * (the first sync of a session, or a sent copy just filed).
   */
  private async pollSideFolder(client: ImapFlow, folder: Folder, force = false) {
    const last = this.sideChecks.get(folder.path);
    // Not STATUS on the folder that is open: IMAP says not to, and imapflow would write the reply into
    // the open mailbox. Syncing an open folder costs no SELECT anyway; the last STATUS stays for comparison.
    const open = !!client.mailbox && client.mailbox.path === folder.path;
    const reply = open ? false : await client.status(folder.path, { uidNext: true, uidValidity: true, messages: true });
    const status: FolderStatus | null = reply ? { uidNext: reply.uidNext, uidValidity: reply.uidValidity, messages: reply.messages } : null;
    const at = Date.now();
    if (!force && !open && !sideFolderDue(last, status, at)) return;
    await this.syncFolder(client, folder);
    this.sideChecks.set(folder.path, { status: open ? (last?.status ?? null) : status, syncedAt: at });
  }

  /** Where this folder's last sync stopped: read once a session, then kept in memory. */
  private async folderState(path: string) {
    if (!this.syncStates.has(path)) {
      const state = await getSyncState(this.id, path);
      this.syncStates.set(path, state && { uid_validity: state.uid_validity, last_uid: state.last_uid });
    }
    return this.syncStates.get(path) ?? null;
  }

  /** Saves where this folder's sync stopped, and keeps the memory copy in step once the save succeeds. */
  private async saveFolderState(path: string, uidValidity: number, lastUid: number) {
    await saveSyncState(this.id, path, { uid_validity: uidValidity, last_uid: lastUid });
    this.syncStates.set(path, { uid_validity: uidValidity, last_uid: lastUid });
  }

  /**
   * Catch-up for files that are not in storage yet: mail synced before files were saved, or an upload
   * that failed. Each message is fetched again from the folder and UID it was stored from.
   */
  private async saveMissingFiles(client: ImapFlow) {
    const todo = await this.missingFiles.next();
    if (todo.length === 0) return;

    const byFolder = new Map<string, { uidValidity: number; messages: Map<number, string> }>();
    for (const r of todo) {
      const meta = r.provider_meta as { folder?: string; uid?: number; uid_validity?: number };
      if (!meta.folder || !meta.uid || !meta.uid_validity) continue;
      const entry = byFolder.get(meta.folder) ?? { uidValidity: meta.uid_validity, messages: new Map() };
      if (entry.uidValidity === meta.uid_validity) entry.messages.set(meta.uid, r.message_id);
      byFolder.set(meta.folder, entry);
    }

    let saved = 0;
    for (const [folder, entry] of byFolder) {
      const lock = await client.getMailboxLock(folder);
      try {
        // A renumbered folder means these UIDs point at other messages now.
        if (Number(client.mailbox && client.mailbox.uidValidity) !== entry.uidValidity) continue;
        for await (const msg of client.fetch([...entry.messages.keys()], { uid: true, source: true }, { uid: true })) {
          const messageId = entry.messages.get(msg.uid);
          if (!messageId || !msg.source) continue;
          const mail = await parseEmail(msg.source, `${folder}:${entry.uidValidity}:${msg.uid}`);
          saved += await saveFilesQuietly(this.id, this.account.user_id, messageId, mail.attachments);
        }
      } finally {
        lock.release();
      }
    }
    if (saved > 0) log.info("attachment files saved", { account: this.id, saved });
  }

  /**
   * Sends one queued reply or new email through the account's SMTP server, then files it in Sent and
   * imports it, so it shows in the conversation like any other message you sent. The sign-in stays
   * the account's own; the envelope and From header use the chosen address.
   */
  async send(queuedRow: OutboxRow) {
    const row = await claimReady(queuedRow); // waits for its files, then claims it
    if (!row) return; // another run already has it, or it failed
    const kind = row.thread_id ? "reply" : "email";
    let raw: Buffer;
    let messageId: string;
    try {
      const creds = this.creds ?? (await loadCredentials<C>(this.id));
      const account = await freshAccount(this.id);
      const out = await composeOutgoing(row, this.id, await this.refreshSelf(creds, { account }), this.service.attachments, account);
      if ("error" in out) {
        await markFailed(row.id, out.error);
        return;
      }
      ({ raw, messageId } = out);

      // The raw message has no Bcc header, so Bcc goes only in the envelope: SMTP delivers to everyone
      // listed there, and no recipient can see who else was copied in secret.
      const envelopeTo = [...new Set([...out.to, ...out.cc, ...out.bcc])];
      const transport = await this.smtp(creds);
      try {
        await transport.sendMail({ envelope: { from: out.from, to: envelopeTo }, raw });
      } finally {
        transport.close();
      }
    } catch (err) {
      const { code, command, responseCode } = err as { code?: string; command?: string; responseCode?: number };
      // A dropped connection or timeout with no reply from the server can come after the message was
      // handed over, so it may have gone out. Saying "try again" would invite a second copy.
      const maybeSent = responseCode === undefined && (command === "DATA" || ["ETIMEDOUT", "ESOCKET", "ECONNECTION"].includes(code ?? ""));
      log.warn(`${kind} failed`, { account: this.id, outbox: row.id, code: errorCode(err), maybeSent });
      const { name, password } = this.service;
      await markFailed(
        row.id,
        responseCode === 552
          ? `${name} refused the ${kind} because it is too large. Remove an attachment, then send again.`
          : code === "EAUTH"
          ? `${name} rejected the ${password}, so the ${kind} was not sent.`
          : code === "EENVELOPE"
            ? `${name} refused the From address or a recipient, so the ${kind} was not sent.`
            : maybeSent
              ? `The ${kind} may have been sent. Check your Sent folder before sending again.`
              : `The ${kind} could not be sent. Try again.`,
      ).catch(() => undefined);
      return;
    }
    if (!(await settleSent(row.id, messageId))) log.warn(`${kind} sent but not recorded`, { account: this.id, outbox: row.id });
    else log.info(`${kind} sent`, { account: this.id, outbox: row.id });
    // Stored from the bytes just sent, so it shows even if filing it in Sent below never happens.
    await this.storeSentCopy(row, raw);

    // Some servers file sent mail themselves. Give it a moment, then file it only if it is not there.
    setTimeout(() => {
      const client = this.client;
      if (client && !this.stopped) this.background(() => this.fileInSent(client, raw, messageId));
    }, 3_000);
  }

  /** Imports a sent email straight away. The Sent folder sync later finds the same Message-ID and only adds where it lives. */
  private async storeSentCopy(row: OutboxRow, raw: Buffer) {
    try {
      const mail = await parseEmail(raw, `outbox:${row.id}`);
      const stored = await storeEmail(this.account, mail, { role: "sent", meta: {}, seen: true, selfAddresses: this.selfAddresses });
      // The bytes are in hand, so the files are saved now rather than fetched again from Sent later.
      if (stored.result === "inserted" && stored.messageId) await saveFilesQuietly(this.id, this.account.user_id, stored.messageId, mail.attachments);
      if (!row.thread_id && stored.threadId) await linkThread(row.id, stored.threadId);
    } catch (err) {
      log.warn("store sent copy failed", { account: this.id, outbox: row.id, code: errorCode(err) });
    }
  }

  private async fileInSent(client: ImapFlow, raw: Buffer, messageId: string) {
    const sent = this.folders.find((f) => f.role === "sent");
    if (!sent) return;
    const lock = await client.getMailboxLock(sent.path);
    try {
      const found = await client.search({ header: { "message-id": messageId } }, { uid: true });
      if (!found || found.length === 0) await client.append(sent.path, raw, ["\\Seen"]);
    } finally {
      lock.release();
    }
    // The open Sent folder's message count predates the copy. Opening the Inbox first makes the
    // import below check Sent by STATUS and reopen it to see the copy, instead of waiting for the next minute's check.
    await client.mailboxOpen("INBOX");
    await this.pollSideFolder(client, sent, true);
    await this.selectInbox(client);
    await this.linkSent();
  }

  /** Lets the app open the conversation a new email started, once its sent copy is stored. */
  private async linkSent() {
    try {
      const linked = await linkNewEmails(this.id);
      if (linked > 0) log.info("new emails linked", { account: this.id, linked });
    } catch (err) {
      log.warn("link new emails failed", { account: this.id, code: errorCode(err) });
    }
  }

  /**
   * Notices mail that left the Inbox on another device (archived, moved, deleted or marked as junk).
   * Those messages stop counting as "in the Inbox". Ones now in Trash or Junk are found there,
   * so a conversation deleted on your phone leaves the app's inbox as deleted, and one marked as junk
   * moves to the app's Junk. A conversation with nothing left in the Inbox is archived otherwise.
   */
  private async reconcileInbox(client: ImapFlow) {
    const rows = await allRows(
      (from, to) =>
        db
          .from("messages")
          .select("id, thread_id, provider_message_id, provider_meta")
          .eq("account_id", this.id)
          .eq("provider_meta->>folder", "INBOX")
          .order("id")
          .range(from, to),
      "load inbox messages",
    );
    if (rows.length === 0) return;

    const lock = await client.getMailboxLock("INBOX");
    let gone: typeof rows;
    try {
      const uidValidity = Number(client.mailbox && client.mailbox.uidValidity);
      // Rows from an older UIDVALIDITY count as gone: their UIDs now point at other messages, if any.
      const current = new Set(rows.filter((r) => (r.provider_meta as { uid_validity?: number }).uid_validity === uidValidity));
      const uids = [...current].map((r) => (r.provider_meta as { uid: number }).uid);
      const present = new Set<number>(uids.length ? ((await client.search({ uid: uidSet(uids) }, { uid: true })) || []) : []);
      gone = rows.filter((r) => !current.has(r) || !present.has((r.provider_meta as { uid?: number }).uid ?? -1));
    } finally {
      lock.release();
    }
    if (gone.length === 0) return;

    const found = await this.locate(client, gone);
    const unknown = gone.filter((r) => !found.has(r.id)).map((r) => r.id);
    for (const ids of chunks(unknown, 200)) {
      must(await db.from("messages").update({ provider_meta: { left: "INBOX" } }).in("id", ids), "mark messages gone");
    }
    await mapLimit([...found], WRITE_AT_ONCE, async ([id, meta]) => {
      must(await db.from("messages").update({ provider_meta: meta }).eq("id", id), "save found message");
    });

    const moved = await this.placeThreads([...new Set(gone.map((r) => r.thread_id))]);
    log.info(`${this.service.tag} inbox reconciled`, { account: this.id, left: gone.length, found: found.size, moved });
  }

  /**
   * Looks for mail that left the Inbox in Trash and Junk, by Message-ID, a batch at a time.
   * Mail not found there was archived or moved to another folder. Leaves the Inbox selected again.
   */
  private async locate(client: ImapFlow, gone: { id: string; provider_message_id: string }[]) {
    const found = new Map<string, { folder: string; uid: number; uid_validity: number }>();
    const byMessageId = new Map(gone.filter((r) => r.provider_message_id.startsWith("<")).map((r) => [r.provider_message_id, r.id]));
    if (byMessageId.size === 0) return found;
    try {
      for (const path of [this.paths.trash, this.paths.junk]) {
        if (!path) continue;
        const todo = [...byMessageId.keys()].filter((mid) => !found.has(byMessageId.get(mid)!));
        if (todo.length === 0) break;
        const lock = await client.getMailboxLock(path);
        try {
          const uidValidity = Number(client.mailbox && client.mailbox.uidValidity);
          for (const batch of chunks(todo, LOCATE_AT_ONCE)) {
            const query = batch.length === 1 ? { header: { "message-id": batch[0] } } : { or: batch.map((mid) => ({ header: { "message-id": mid } })) };
            const uids = (await client.search(query, { uid: true })) || [];
            if (uids.length === 0) continue;
            for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
              const id = msg.envelope?.messageId && byMessageId.get(msg.envelope.messageId.trim());
              if (id) found.set(id, { folder: path, uid: msg.uid, uid_validity: uidValidity });
            }
          }
        } finally {
          lock.release();
        }
      }
    } finally {
      await this.selectInbox(client);
    }
    return found;
  }

  /**
   * Moves conversations with nothing left in the Inbox to where their mail is: archived, deleted, or
   * the app's Junk for mail in Junk. Conversations with a change from the app still on its way are
   * left alone. untrash: mail just turned up in Archive, so a deleted conversation is archived again.
   */
  private async placeThreads(threadIds: string[], untrash = false): Promise<number> {
    if (threadIds.length === 0) return 0;
    // Every message of every thread is read, a chunk of threads and a page of rows at a time, so no
    // thread is judged on part of its mail and archived by mistake.
    const byThread = new Map<string, { folder?: string; direction: string }[]>();
    const waiting = new Set<string>();
    for (const chunk of chunks(threadIds, THREADS_AT_ONCE)) {
      const rows = await allRows(
        (from, to) =>
          db.from("messages").select("id, thread_id, direction, provider_meta").in("thread_id", chunk).eq("account_id", this.id).order("id").range(from, to),
        "check thread folders",
      );
      for (const r of rows) push(byThread, r.thread_id, { folder: (r.provider_meta as { folder?: string }).folder, direction: r.direction });
      const queued = await allRows(
        (from, to) => db.from("mail_actions").select("id, thread_id").in("thread_id", chunk).eq("status", "queued").order("id").range(from, to),
        "check queued actions",
      );
      for (const r of queued) waiting.add(r.thread_id);
    }
    const place = new Map(threadIds.filter((id) => !waiting.has(id)).map((id) => [id, imapThreadPlace(byThread.get(id) ?? [], this.paths)]));
    const at = (wanted: string) => [...place].filter(([, p]) => p === wanted).map(([id]) => id);

    let changed = 0;
    const count = (rows: { id: string }[]) => (changed += rows.length);
    const threads = () => db.from("threads");
    const archive = at("archived");
    if (archive.length) {
      count(must(await threads().update({ status: "archived" }).in("id", archive).eq("status", "inbox").select("id"), "archive threads"));
      if (untrash) count(must(await threads().update({ status: "archived" }).in("id", archive).eq("status", "trash").select("id"), "untrash threads"));
    }
    const binned = at("trash");
    if (binned.length) count(must(await threads().update({ status: "trash" }).in("id", binned).in("status", ["inbox", "archived"]).select("id"), "bin threads"));
    const junk = at("spam");
    if (junk.length) {
      count(must(await threads().update({ status: "inbox" }).in("id", junk).neq("status", "inbox").select("id"), "show junk threads"));
      count(must(await threads().update({ junk: true }).in("id", junk).eq("junk", false).select("id"), "mark junk threads"));
    }
    return changed;
  }

  /** Applies a read, unread, archive, unarchive, delete, undelete, junk or not junk made in the app to the messages on the server. */
  /**
   * An email as it was sent, for View Original: its HTML, null when it has none, or "missing" when it is no
   * longer where it was stored (moved or deleted on another device). Fetched on request rather than stored.
   */
  async original(meta: Json): Promise<string | null | "missing"> {
    const { folder, uid } = (meta ?? {}) as { folder?: string; uid?: number };
    if (!folder || !uid) return "missing";
    let result: string | null | "missing" = "missing";
    await this.queue.run(async () => {
      const client = this.client;
      if (!client) throw Object.assign(new Error("not connected"), { code: "NOT_CONNECTED" });
      const lock = await client.getMailboxLock(folder);
      try {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && msg.source) result = (await parseEmail(msg.source, `imap:${folder}:${uid}`)).html;
      } finally {
        lock.release();
      }
    });
    return result;
  }

  async applyAction(row: Tables<"mail_actions">) {
    if (!this.client || this.folders.length === 0) return; // still connecting: the next poll retries it
    const run = async () => {
      const client = this.client;
      if (!client) throw Object.assign(new Error("not connected"), { code: "NOT_CONNECTED" });
      const messages = must(
        await db
          .from("messages")
          .select("id, direction, provider_meta")
          .eq("thread_id", row.thread_id)
          .eq("account_id", this.id),
        "load action messages",
      );
      const located = messages
        .map((m) => ({ id: m.id, direction: m.direction, meta: m.provider_meta as { folder?: string; uid?: number; uid_validity?: number; from?: string } }))
        .filter((m) => m.meta.folder && m.meta.uid);

      const pick = (want: (m: (typeof located)[number]) => boolean) => {
        const byFolder = new Map<string, typeof located>();
        for (const m of located.filter(want)) push(byFolder, m.meta.folder!, m);
        return byFolder;
      };

      if (row.action === "read" || row.action === "unread") {
        for (const [folder, list] of pick((m) => m.direction === "inbound")) {
          const lock = await client.getMailboxLock(folder);
          try {
            const uids = list.map((m) => m.meta.uid!);
            if (row.action === "read") await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
            // Unread marks only the latest message, as in Mail.
            else await client.messageFlagsRemove([Math.max(...uids)], ["\\Seen"], { uid: true });
          } finally {
            lock.release();
          }
          if (row.action === "unread") break;
        }
        return;
      }

      const move = imapMove(row.action, this.paths);
      if (!move) throw Object.assign(new Error("unknown action"), { code: "UNKNOWN_ACTION" });
      if ("missing" in move) throw Object.assign(new Error("missing folder"), { code: `NO_${move.missing.toUpperCase()}` });
      // Undoing Not Junk only puts back mail that Not Junk took out of Junk; junk the AI sorted out stays put.
      const undo = await undoesNotJunk(db, row);
      const wanted = (m: (typeof located)[number]) =>
        move.from.includes(m.meta.folder!) && (!undo || (!!this.paths.junk && m.meta.from === this.paths.junk));
      for (const [folder, list] of pick(wanted)) {
        // Undoing a delete can send messages from one folder to different places.
        const byDestination = new Map<string, typeof list>();
        for (const m of list) push(byDestination, move.to(m.meta.from), m);
        for (const [to, group] of byDestination) {
          if (to === folder) continue;
          const lock = await client.getMailboxLock(folder);
          try {
            const moved = await client.messageMove(group.map((m) => m.meta.uid!), to, { uid: true });
            if (!moved) continue;
            await mapLimit(group, WRITE_AT_ONCE, async (m) => {
              const newUid = moved.uidMap?.get(m.meta.uid!);
              const meta = newUid
                ? { folder: to, uid: newUid, uid_validity: Number(moved.uidValidity ?? 0), ...(move.remember ? { from: folder } : {}) }
                : { left: folder }; // the server did not say where it went: the next sync finds it
              must(await db.from("messages").update({ provider_meta: meta }).eq("id", m.id), "save moved message");
            });
          } finally {
            lock.release();
          }
        }
      }
    };

    try {
      await this.queue.run(run);
      await finishAction(row.id);
    } catch (err) {
      log.warn("mail action failed", { account: this.id, action: row.action, code: errorCode(err) });
      const code = (err as { code?: string }).code;
      const { name, object, trashName } = this.service;
      const reason =
        code === "NO_ARCHIVE"
          ? `${name} has no Archive folder.`
          : code === "NO_TRASH"
            ? `${name} has no ${trashName} folder.`
            : code === "NO_JUNK"
              ? `${name} has no Junk folder.`
              : `Could not update ${object}. It will match on the next change.`;
      await finishAction(row.id, reason);
    }
  }

  /** Unsubscribes from one sender. An unsubscribe email goes out through the account's SMTP server. */
  async unsubscribe(row: Tables<"unsubscribes">) {
    await carryOutUnsubscribe(this.id, row, (mailto) => this.mailtoUnsubscribe(mailto));
  }

  private async mailtoUnsubscribe(mailto: MailtoUnsubscribe) {
    const creds = this.creds ?? (await loadCredentials<C>(this.id));
    const transport = await this.smtp(creds);
    try {
      await transport.sendMail({ from: this.account.address, to: mailto.to, subject: mailto.subject, text: mailto.body });
    } finally {
      transport.close();
    }
  }

  /** A one-off SMTP connection to the account's server, signed in with its login. Close it when done. */
  private async smtp(creds: C) {
    return nodemailer.createTransport({
      ...(await this.service.smtp(creds)),
      auth: { user: creds.username, pass: creds.password },
      logger: false, // its logs include message content
    });
  }

  /**
   * A queued step nobody awaits. If the IMAP side failed, drop the connection so the reconnect loop
   * recovers cleanly. A database error only skips the step: the next minute tries again on the same connection.
   */
  private background(step: () => Promise<void>) {
    this.queue.background(step, (err) => {
      const client = this.client;
      const reconnect = !client?.usable || isImapError(err);
      log.warn(`${this.service.tag} background step failed`, { account: this.id, code: errorCode(err), reconnect });
      if (reconnect) client?.close();
    });
  }
}
