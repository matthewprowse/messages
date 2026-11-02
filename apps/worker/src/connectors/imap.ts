// Any IMAP and SMTP mailbox: iCloud+ Mail (./icloud.ts), and mail on your own domain at any host (Afrihost,
// xneelo, cPanel and Dovecot servers, Yahoo, Fastmail, Zoho). IMAP to sync both ways, SMTP to send replies and
// unsubscribe emails. Read, unread, archive, delete and junk in the app are applied to the server (delete moves
// mail to Trash, never deletes it for good), and mail moved or deleted on another device leaves the app's
// inbox. Trash and Junk are never imported; they are only looked in for mail that left the Inbox. What differs
// from one service to the next, where its servers are and how it is named, is in ./mail-service.ts.
//
// Cost: the five-minute Inbox reconcile reads the whole Inbox only when the server's UIDVALIDITY, UIDNEXT and
// message count stop adding up (or an expunge event, or an hour has passed), see ./inbox-check.ts. Memory: a
// sync batch is stored when it holds 25 messages or about 16 MB of attachments, whichever comes first, and each
// message's file Buffers are dropped as soon as it is stored.

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { Backoff, SerialQueue, sleep, supervise } from "../backoff";
import { db, getSyncState, loadCredentials, must, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { parseEmail, type EmailAttachment } from "../ingest/normalize-email";
import { applyReadState, storeEmail } from "../ingest/store-email";
import { sideFolderDue, type FolderCheck, type FolderStatus } from "../ingest/folder-status";
import { saveFilesQuietly } from "../ingest/attachment-files";
import { BackoffMissingFiles } from "../missing-files";
import { claimReady, composeOutgoing, freshAccount, linkNewEmails, linkThread, markFailed, settleSent, type OutboxRow, type SendAccount } from "../send/outbox";
import { normAddresses } from "../send/from-address";
import { carryOutUnsubscribe, type MailtoUnsubscribe } from "../send/unsubscribe-flow";
import type { Json, Tables } from "@messages/db";
import type { FolderPaths } from "../ingest/imap-place";
import { finishAction, NotReady } from "../send/actions";
import { pickFolders } from "../ingest/imap-folders";
import { sealAddress } from "../vault";
import { reconcileDue, type InboxMark } from "./inbox-check";
import type { ImapCredentials, MailCredentials, MailService } from "./mail-service";
import { applyMessageAction } from "../imap/apply-action";
import { actionFailureReason, isImapError, maybeSent, sendFailureReason } from "../imap/errors";
import { saveMissingFiles } from "../imap/missing-files";
import { placeThreads } from "../imap/place-threads";
import { reconcileInboxFully } from "../imap/reconcile-inbox";
import { syncFolder, type Folder, type SyncCtx } from "../imap/sync-folder";

const SIDE_FOLDER_POLL_MS = 60_000; // every folder is checked each minute (the others by STATUS); the Inbox is also live through IDLE
const RECONCILE_EVERY_TICKS = 5; // the Inbox is checked every 5 minutes (a full pass only when its numbers moved, see ./inbox-check.ts); expunge events cover quick changes
const FILES_EVERY_TICKS = 10;
const SELF_EVERY_TICKS = 10; // ticks (minutes) between reads of the account for edited send addresses

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
  /** The Inbox numbers and time of the last full reconcile this session; null until the first. */
  private lastReconcile: { mark: InboxMark; at: number } | null = null;

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
    void supervise(() => this.run(), () => this.stopped, (err) => log.error("imap run loop failed", { account: this.id, code: errorCode(err) }));
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
          await setAccountStatus(this.id, "error", this.creds ? this.service.rejected(this.creds) : `${this.service.name} rejected the ${this.service.password}. Reconnect in Settings.`).catch(() => undefined);
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
    this.lastReconcile = null;
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
      this.backoff.reset(); // only once the first sync worked: a sync that always fails must keep backing off
      await setAccountStatus(this.id, "connected");
      this.background(() => this.saveMissingFiles(client));

      // Live: new Inbox mail arrives through IDLE; read/unread changes arrive as flag updates.
      client.on("exists", (event: { path: string }) => {
        if (event.path === inbox.path) this.background(() => this.syncFolder(client, inbox));
      });
      client.on("expunge", (event: { path: string }) => {
        if (event.path === inbox.path) this.background(() => this.reconcileInbox(client, true));
      });
      client.on("flags", (event: { path: string; uid?: number; flags: Set<string> }) => {
        if (event.uid === undefined) return;
        const uid = event.uid;
        // The UID only means something within one UIDVALIDITY. Unknown: skip rather than flip another message.
        const mailbox = client.mailbox && client.mailbox.path === event.path ? Number(client.mailbox.uidValidity) : this.syncStates.get(event.path)?.uid_validity;
        if (mailbox === undefined || mailbox === null || !Number.isFinite(mailbox)) return;
        const uidValidity = mailbox;
        this.background(() => applyReadState(this.account, event.path, uid, event.flags.has("\\Seen"), uidValidity));
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
        // Send addresses edited in the app count as you within ten minutes: the account is read and decrypted for
        // this, which is too much work to repeat every minute for every mailbox. The session start read them already.
        if (tick > 0 && tick % SELF_EVERY_TICKS === 0)
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

  /** What the folder sync (../imap/sync-folder.ts) reads from this session. */
  private syncCtx(): SyncCtx {
    return {
      account: this.account,
      tag: this.service.tag,
      selfAddresses: () => this.selfAddresses,
      folderState: (path) => this.folderState(path),
      saveFolderState: (path, uidValidity, lastUid) => this.saveFolderState(path, uidValidity, lastUid),
      placeThreads: (ids, untrash) => this.placeThreads(ids, untrash),
    };
  }

  private syncFolder(client: ImapFlow, folder: Folder) {
    return syncFolder(this.syncCtx(), client, folder);
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

  /** Catch-up for files that are not in storage yet (../imap/missing-files.ts). */
  private async saveMissingFiles(client: ImapFlow) {
    await saveMissingFiles(client, this.id, this.account.user_id, await this.missingFiles.next());
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
      const failure = err as { code?: string; command?: string; responseCode?: number };
      log.warn(`${kind} failed`, { account: this.id, outbox: row.id, code: errorCode(err), maybeSent: maybeSent(failure) });
      await markFailed(row.id, sendFailureReason(failure, kind, this.service)).catch(() => undefined);
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
  private async reconcileInbox(client: ImapFlow, forced = false) {
    // One look at the numbers the server reports decides whether the full pass is needed (./inbox-check.ts).
    const mark = await this.inboxMark(client);
    if (!mark || !reconcileDue(this.lastReconcile, mark, Date.now(), forced)) return;
    await this.reconcileInboxFully(client);
    this.lastReconcile = { mark, at: Date.now() };
  }

  /**
   * UIDVALIDITY, UIDNEXT and the message count of the open Inbox, with no extra request. imapflow does not
   * raise UIDNEXT when IDLE reports new mail, so the stored sync position stands in when it is higher.
   */
  private async inboxMark(client: ImapFlow): Promise<InboxMark | null> {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox;
      if (!box) return null;
      const lastUid = (await this.folderState("INBOX"))?.last_uid ?? 0;
      return { uidValidity: Number(box.uidValidity), uidNext: Math.max(box.uidNext, lastUid + 1), exists: box.exists };
    } finally {
      lock.release();
    }
  }

  private reconcileInboxFully(client: ImapFlow) {
    return reconcileInboxFully(
      { accountId: this.id, tag: this.service.tag, paths: () => this.paths, selectInbox: (c) => this.selectInbox(c), placeThreads: (ids) => this.placeThreads(ids) },
      client,
    );
  }

  /** Moves conversations with nothing left in the Inbox to where their mail is (../imap/place-threads.ts). */
  private placeThreads(threadIds: string[], untrash = false): Promise<number> {
    return placeThreads(this.id, this.paths, threadIds, untrash);
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

  /** A message's files, fetched again for one the owner opened (ingest/fetch-requests.ts). null when it is no longer where it was stored. */
  async attachmentsOf(meta: Json): Promise<EmailAttachment[] | null> {
    const { folder, uid, uid_validity } = (meta ?? {}) as { folder?: string; uid?: number; uid_validity?: number };
    if (!folder || !uid) return null;
    let result: EmailAttachment[] | null = null;
    await this.queue.run(async () => {
      const client = this.client;
      if (!client) throw Object.assign(new Error("not connected"), { code: "NOT_CONNECTED" });
      const lock = await client.getMailboxLock(folder);
      try {
        // A renumbered folder means this UID points at another message now.
        if (uid_validity && Number(client.mailbox && client.mailbox.uidValidity) !== uid_validity) return;
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && msg.source) result = (await parseEmail(msg.source, `imap:${folder}:${uid}`)).attachments;
      } finally {
        lock.release();
      }
    });
    return result;
  }

  async applyAction(row: Tables<"mail_actions">) {
    if (!this.client || this.folders.length === 0) throw new NotReady(); // still connecting: back to queued
    const run = async () => {
      const client = this.client;
      if (!client) throw Object.assign(new Error("not connected"), { code: "NOT_CONNECTED" });
      await applyMessageAction(client, this.id, row, this.paths);
    };

    try {
      await this.queue.run(run);
      await finishAction(row.id);
    } catch (err) {
      log.warn("mail action failed", { account: this.id, action: row.action, code: errorCode(err) });
      const reason = actionFailureReason((err as { code?: string }).code, this.service);
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
