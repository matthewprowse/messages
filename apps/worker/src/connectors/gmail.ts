// Gmail through its REST API: Gmail's own conversation IDs, labels for read and Inbox state, and its
// change history for updates. The history is checked every 5 seconds while the mailbox is active (mail changed, or the app sent or acted
// on it in the last 10 minutes), every 30 s after that and every 60 s once quiet for an hour (polling.ts),
// which keeps new mail within the 10-second target in use without Google Cloud Pub/Sub. Read, unread, archive, delete and junk in the app
// change the labels in Gmail (delete moves mail to the Bin, never deletes it for good). Mail moved to the
// Bin or Spam in Gmail leaves the app's inbox. Replies are sent through Gmail, which files them in Sent itself.

import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type { Json, Tables } from "@messages/db";
import { Backoff, SerialQueue, Sleeper, supervise } from "../backoff";
import { accountActivity, GMAIL_POLL } from "../polling";
import { allRows, db, getSyncState, must, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { chunks, mapLimit, push } from "../util";
import { normalizeEmail, type EmailAttachment, type NormalizedEmail } from "../ingest/normalize-email";
import { storeEmail, storeEmails, type EmailContext } from "../ingest/store-email";
import { isFailure } from "../ingest/batch-rpc";
import { saveFilesQuietly } from "../ingest/attachment-files";
import { BackoffMissingFiles } from "../missing-files";
import { claimReady, composeOutgoing, linkNewEmails, linkThread, markFailed, settleSent, startedHere, type OutboxRow } from "../send/outbox";
import { finishAction, NotReady } from "../send/actions";
import { carryOutUnsubscribe, type MailtoUnsubscribe } from "../send/unsubscribe-flow";
import { normAddresses } from "../send/from-address";
import { GoogleApiError, signInRevoked, type GoogleClient } from "../google/client";
import { GMAIL_UPLOAD_SEND, UPLOAD_TIMEOUT_MS, gmailUploadRequest } from "../google/gmail-upload";
import { GMAIL_SCOPE, GoogleAuthError } from "../google/oauth";
import { googleFatalDetail, openGoogleClient } from "../google/session";
import { actionLabels, applyLabelChange, hidden, historyChanges, roleOf, threadPlace, type HistoryRecord } from "../google/gmail-labels";
import { undoesNotJunk } from "../ingest/junk-undo";
import { sealAddress } from "../vault";
import { freshAccount } from "../send/outbox";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_FAILED_CHECKS = 12; // about a minute of checks failing in a row
const FETCH_AT_ONCE = 8; // Gmail allows about 50 message fetches a second per user
const STORE_AT_ONCE = 25; // messages per database call during imports; the next chunk is fetched meanwhile
const SETTLE_AT_ONCE = 100; // conversations placed together during a full sync
const PROGRESS_EVERY = 500;
const FILES_EVERY_MS = 10 * 60_000;
const WRITE_AT_ONCE = 6; // row updates in flight together when many messages change at once
const FILES_AT_ONCE = 200; // attachment rows checked per catch-up
const HISTORY_TYPES = ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"];

// A type, not an interface, so it counts as JSON for the provider_meta column.
type GmailMeta = {
  gmail_id?: string;
  thread_id?: string;
  labels?: string[];
  deleted?: boolean;
  /** Set when the app moved the message to the Bin: whether it was in the Inbox, so undo can put it back. */
  was_inbox?: boolean;
  /** Set when Not Junk in the app took the message out of Spam, so its undo puts back only those. */
  was_spam?: boolean;
};

/** A stored message as the history check compares it with Gmail. */
interface KnownMessage {
  id: string;
  threadId: string;
  direction: string;
  isRead: boolean;
  meta: GmailMeta;
}

/** Whether two label lists hold the same labels, in any order. */
function sameLabels(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((l) => b.includes(l));
}

interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  raw?: string;
}

export class GmailConnector {
  private client: GoogleClient | null = null;
  private stopped = false;
  private ready = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  /** Changes are applied one at a time, so a history check never races an action from the app. */
  private readonly queue = new SerialQueue();
  private selfAddresses = new Set<string>();
  /** Where Gmail's change history was last read up to. Loaded once per session, then kept here. */
  private historyId: string | null = null;
  /** Attachment rows with no stored file yet, a page per catch-up. */
  private readonly missingFiles: BackoffMissingFiles;

  constructor(private readonly account: AccountRow) {
    this.missingFiles = new BackoffMissingFiles(account.id, FILES_AT_ONCE);
  }

  get id() {
    return this.account.id;
  }

  start() {
    void supervise(() => this.run(), () => this.stopped, (err) => log.error("gmail run loop failed", { account: this.id, code: errorCode(err) }));
  }

  async stop() {
    this.stopped = true;
    this.sleeper.interrupt();
    accountActivity.forget(this.id);
  }

  private async run() {
    while (!this.stopped) {
      try {
        await this.session();
      } catch (err) {
        if (this.stopped) break;
        // A revoked sign-in, a missing OAuth client or Gmail not granted: retrying cannot fix these, so
        // stop until the connect command or a restart does.
        const fatal = googleFatalDetail(err, "Gmail");
        if (fatal) {
          if (signInRevoked(err)) log.error("gmail sign-in revoked", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", fatal).catch(() => undefined);
          return;
        }
        log.warn("gmail session failed", { account: this.id, code: errorCode(err) });
        await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
      }
      this.ready = false;
      if (this.stopped) break;
      const delay = this.backoff.next();
      log.info("gmail reconnecting", { account: this.id, inMs: delay });
      await this.sleeper.wait(delay);
    }
  }

  /** One session: catch up on everything, then check Gmail's change history every few seconds. */
  private async session() {
    await setAccountStatus(this.id, "connecting");
    const { client } = await openGoogleClient(this.id, GMAIL_SCOPE);
    this.client = client;
    this.queue.reset();

    const [profile, sendAs] = await Promise.all([
      client.request<{ emailAddress: string; historyId: string }>(`${API}/profile`),
      client.request<{ sendAs?: { sendAsEmail: string; isPrimary?: boolean; verificationStatus?: string }[] }>(`${API}/settings/sendAs`),
    ]);
    const entries = sendAs.sendAs ?? [];
    // Gmail sends only from verified "Send mail as" addresses; pending ones still count as you.
    const sendable = [
      ...new Set(
        normAddresses([this.account.address, profile.emailAddress, ...entries.filter((e) => e.isPrimary || e.verificationStatus !== "pending").map((e) => e.sendAsEmail)]),
      ),
    ];
    // Saved only when the list changed: an address is encrypted afresh each time it is stored.
    const current = (await freshAccount(this.id)).send_addresses;
    if (current.length !== sendable.length || current.some((a, i) => a !== sendable[i])) {
      const stored = await Promise.all(sendable.map((a) => sealAddress(this.account.user_id, a)));
      must(await db.from("accounts").update({ send_addresses: stored }).eq("id", this.id), "save send addresses");
    }
    this.selfAddresses = new Set([...sendable, ...normAddresses(entries.map((e) => e.sendAsEmail))]);
    log.info("gmail connected", { account: this.id, addresses: this.selfAddresses.size });

    await setAccountStatus(this.id, "syncing");
    const state = await getSyncState(this.id, "history");
    this.historyId = state?.history_id ?? null;
    await this.queue.run(() => (this.historyId ? this.catchUp(this.historyId) : this.fullSync(profile.historyId)));
    this.backoff.reset(); // only once the first sync worked: a sync that always fails must keep backing off
    await setAccountStatus(this.id, "connected");
    this.ready = true;
    this.background(() => this.saveMissingFiles());

    let lastFiles = Date.now();
    let lastTouch = Date.now();
    let failures = 0;
    accountActivity.mark(this.id); // a new session starts with quick checks
    // Work the app does for this account (a send, an action) ends an idle wait early.
    const wakeOnActivity = accountActivity.onMark(this.id, () => this.sleeper.interrupt());
    try {
      while (!this.stopped) {
        // 5 s while this mailbox has had activity recently, backing off to 30 s then 60 s when quiet (see
        // polling.ts); a failed check retries quickly.
        await this.sleeper.wait(failures > 0 ? GMAIL_POLL.activeMs : accountActivity.delay(this.id, GMAIL_POLL));
        if (this.stopped) break;
        // One failed check (a Gmail rate limit, a database hiccup) is retried at the next one rather than
        // ending the session. A revoked sign-in ends it at once, and a minute of failures in a row ends it
        // too, so the reconnect (with backoff) takes over instead of logging forever.
        try {
          await this.queue.run(async () => {
            if (this.historyId) await this.catchUp(this.historyId);
          });
          failures = 0;
        } catch (err) {
          if (signInRevoked(err) || ++failures >= MAX_FAILED_CHECKS) throw err;
          log.warn("gmail history check failed", { account: this.id, code: errorCode(err), failures });
        }
        if (Date.now() - lastTouch > 60_000) {
          lastTouch = Date.now();
          await touchAccount(this.id);
          // A new email whose sent copy arrived through the history check rather than right after sending.
          await linkNewEmails(this.id).catch((err) => log.warn("link new emails failed", { account: this.id, code: errorCode(err) }));
        }
        if (Date.now() - lastFiles > FILES_EVERY_MS) {
          lastFiles = Date.now();
          this.background(() => this.saveMissingFiles());
        }
      }
    } finally {
      wakeOnActivity();
    }
  }

  /**
   * First sync, or a restart after Gmail's history ran out: imports the last 30 days, oldest first.
   * Messages already stored are skipped, so an interrupted first sync resumes rather than repeats.
   * The history position is taken before listing, so changes made meanwhile are caught afterwards.
   */
  private async fullSync(historyId: string) {
    const client = this.need();
    const since = Math.floor((Date.now() - env.initialSyncDays * 86_400_000) / 1000);
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await client.request<{ messages?: { id: string }[]; nextPageToken?: string }>(`${API}/messages`, {
        query: { q: `after:${since} -in:drafts -in:chats`, maxResults: 500, pageToken },
      });
      ids.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && !this.stopped);
    ids.reverse(); // Gmail lists newest first

    const known = await this.knownMessages(ids);
    const todo = ids.filter((id) => !known.has(id));
    // Conversations are placed as their mail is stored, a hundred at a time, so an import that stops
    // early leaves none of them unplaced.
    const touched = new Set<string>();
    const settle = async () => {
      await this.settleThreads([...touched]);
      touched.clear();
    };
    let processed = 0;
    let inserted: number;
    try {
      inserted = await this.importMessages(todo, touched, async (count) => {
        if (touched.size >= SETTLE_AT_ONCE) await settle();
        if (Math.floor((processed + count) / PROGRESS_EVERY) > Math.floor(processed / PROGRESS_EVERY)) {
          log.info("gmail import progress", { account: this.id, processed: known.size + processed + count, of: ids.length });
        }
        processed += count;
      });
    } catch (err) {
      await settle().catch(() => undefined);
      throw err;
    }
    await settle();
    if (this.stopped) return;
    await saveSyncState(this.id, "history", { history_id: historyId });
    this.historyId = historyId;
    log.info("gmail full sync done", { account: this.id, listed: ids.length, inserted });
  }

  /** Applies everything that changed in Gmail since the stored history position. */
  private async catchUp(startHistoryId: string) {
    const client = this.need();
    const records: HistoryRecord[] = [];
    let latest = startHistoryId;
    let pageToken: string | undefined;
    try {
      do {
        const page = await client.request<{ history?: HistoryRecord[]; historyId: string; nextPageToken?: string }>(`${API}/history`, {
          query: { startHistoryId, historyTypes: HISTORY_TYPES, maxResults: 500, pageToken },
        });
        records.push(...(page.history ?? []));
        latest = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (err) {
      // Gmail keeps about a week of history. Older than that, start again from a full sync.
      if (err instanceof GoogleApiError && err.status === 404) {
        log.warn("gmail history expired", { account: this.id });
        const profile = await client.request<{ historyId: string }>(`${API}/profile`);
        await this.fullSync(profile.historyId);
        return;
      }
      throw err;
    }

    if (records.length > 0) {
      accountActivity.mark(this.id); // something happened in this mailbox: keep checking quickly for a while
      await this.applyChanges(records);
    }
    if (latest !== startHistoryId) await saveSyncState(this.id, "history", { history_id: latest });
    this.historyId = latest;
  }

  private async applyChanges(records: HistoryRecord[]) {
    const changes = historyChanges(records);
    const ids = [...new Set([...changes.added.keys(), ...changes.relabelled.keys(), ...changes.deleted])];
    const known = await this.knownMessages(ids);
    const touched = new Set<string>(); // conversations to settle
    const changed = new Set<string>(); // conversations whose stored messages changed here, to refresh

    // New to the app: new mail, a draft that was sent, or mail moved out of spam or the bin.
    const fresh = [
      ...[...changes.added].filter(([id, labels]) => !known.has(id) && !hidden(labels)).map(([id]) => id),
      ...[...changes.relabelled].filter(([id, labels]) => !known.has(id) && !(labels && hidden(labels))).map(([id]) => id),
    ];
    // Storing a message refreshes its conversation already.
    const inserted = await this.importMessages(fresh, touched);

    // Labels changed on mail the app has: read state and where it is.
    const missingLabels = [...changes.relabelled].filter(([id, labels]) => known.has(id) && labels === null).map(([id]) => id);
    const fetched = new Map<string, string[]>();
    for (const batch of chunks(missingLabels, FETCH_AT_ONCE)) {
      if (this.stopped) break;
      for (const msg of await Promise.all(batch.map((id) => this.fetchMessage(id, "minimal")))) if (msg) fetched.set(msg.id, msg.labelIds ?? []);
    }
    const updates = new Map<string, string[]>();
    const unspammed = new Set<string>(); // conversations taken out of Spam in Gmail
    for (const [id, labels] of [...changes.relabelled, ...changes.added]) {
      const row = known.get(id);
      if (row) updates.set(id, labels ?? fetched.get(id) ?? row.meta.labels ?? []);
    }
    const writes: { row: KnownMessage; patch: { provider_meta: GmailMeta; is_read?: boolean } }[] = [];
    for (const [gmailId, labels] of updates) {
      const row = known.get(gmailId)!;
      touched.add(row.threadId);
      const before = row.meta.labels ?? [];
      const isRead = row.direction === "inbound" ? !labels.includes("UNREAD") : row.isRead;
      // Often just the echo of an action from the app, which stored the new labels already.
      if (sameLabels(before, labels) && isRead === row.isRead) continue;
      const patch: { provider_meta: GmailMeta; is_read?: boolean } = { provider_meta: { ...row.meta, labels } };
      if (row.direction === "inbound") patch.is_read = isRead;
      if (before.includes("SPAM") && !labels.includes("SPAM")) unspammed.add(row.threadId);
      writes.push({ row, patch });
    }
    // A mass read or archive in Gmail changes many messages at once, so these go a few at a time.
    await mapLimit(writes, WRITE_AT_ONCE, async ({ row, patch }) => {
      must(await db.from("messages").update(patch).eq("id", row.id), "update gmail labels");
      changed.add(row.threadId);
    });
    const relabelled = writes.length;

    // Deleted for good in Gmail: the app keeps its copy, but it no longer counts as in the Inbox.
    const gone: KnownMessage[] = [];
    for (const gmailId of changes.deleted) {
      const row = known.get(gmailId);
      if (!row) continue;
      touched.add(row.threadId);
      if (row.meta.deleted && !row.meta.labels?.length) continue;
      gone.push(row);
    }
    await mapLimit(gone, WRITE_AT_ONCE, async (row) => {
      must(await db.from("messages").update({ provider_meta: { ...row.meta, labels: [], deleted: true } }).eq("id", row.id), "mark gmail deleted");
      changed.add(row.threadId);
    });

    await mapLimit([...changed], WRITE_AT_ONCE, async (threadId) => {
      must(await db.rpc("refresh_thread", { p_thread_id: threadId }), "refresh thread");
    });
    await this.settleThreads([...touched], unspammed);
    log.info("gmail changes applied", { account: this.id, inserted, relabelled, deleted: changes.deleted.size });
  }

  /** Stored messages among these Gmail IDs, keyed by Gmail ID. */
  private async knownMessages(gmailIds: string[]) {
    const out = new Map<string, KnownMessage>();
    for (const ids of chunks(gmailIds, 100)) {
      const rows = must(
        await db
          .from("messages")
          .select("id, thread_id, direction, is_read, provider_meta")
          .eq("account_id", this.id)
          .in("provider_meta->>gmail_id", ids),
        "load known gmail messages",
      );
      for (const r of rows) {
        const meta = r.provider_meta as GmailMeta;
        if (meta.gmail_id) out.set(meta.gmail_id, { id: r.id, threadId: r.thread_id, direction: r.direction, isRead: r.is_read, meta });
      }
    }
    return out;
  }

  /**
   * Fetches and stores messages in order, a chunk per database call (one message alone goes on its own).
   * Each chunk is fetched a few messages at a time while the chunk before it is stored. A message that
   * cannot be stored does not stop the rest; the first such failure is thrown at the end, so the caller
   * does not move past it. afterChunk runs once each chunk is stored, with how many IDs it covered.
   * Returns how many were new.
   */
  private async importMessages(gmailIds: string[], touched: Set<string>, afterChunk?: (count: number) => Promise<void>): Promise<number> {
    const fetchChunk = (ids: string[]) => {
      const fetching = mapLimit(ids, FETCH_AT_ONCE, async (id) => {
        const msg = await this.fetchMessage(id, "raw");
        return msg && (await this.prepare(msg));
      });
      fetching.catch(() => undefined); // awaited below; this keeps one left unused by a stop or failure quiet
      return fetching;
    };
    const batches = chunks(gmailIds, STORE_AT_ONCE);
    let next = batches.length > 0 ? fetchChunk(batches[0]) : null;
    let inserted = 0;
    let failed = 0;
    let failure: string | null = null;
    for (let i = 0; next && !this.stopped; i++) {
      const items = (await next).filter((item) => item !== null);
      next = i + 1 < batches.length ? fetchChunk(batches[i + 1]) : null;
      const results = await storeEmails(this.account, items);
      for (const [j, stored] of results.entries()) {
        if (isFailure(stored)) {
          failed++;
          failure ??= stored.code;
          continue;
        }
        if (stored.threadId) touched.add(stored.threadId);
        if (stored.result === "inserted") {
          inserted++;
          if (stored.messageId) await saveFilesQuietly(this.id, this.account.user_id, stored.messageId, items[j].mail.attachments);
        }
      }
      if (afterChunk) await afterChunk(batches[i].length);
    }
    if (failure !== null) {
      log.warn("gmail messages not stored", { account: this.id, failed, inserted });
      throw Object.assign(new Error("message not stored"), { code: failure });
    }
    return inserted;
  }

  /**
   * An email as it was sent, for View Original: its HTML, null when it has none, or "missing" when Gmail
   * no longer has it. Fetched on request rather than stored.
   */
  async original(meta: Json): Promise<string | null | "missing"> {
    const gmailId = (meta as { gmail_id?: string } | null)?.gmail_id;
    if (!gmailId) return "missing";
    const msg = await this.fetchMessage(gmailId, "raw");
    if (!msg?.raw) return "missing";
    return (await this.parse(msg)).html;
  }

  /** A message's files, fetched again for one the owner opened (ingest/fetch-requests.ts). null when Gmail no longer has the message. */
  async attachmentsOf(meta: Json): Promise<EmailAttachment[] | null> {
    const gmailId = (meta as { gmail_id?: string } | null)?.gmail_id;
    const msg = gmailId ? await this.fetchMessage(gmailId, "raw") : null;
    return msg?.raw ? (await this.parse(msg)).attachments : null;
  }

  /** One message, or null when Gmail no longer has it. */
  private async fetchMessage(gmailId: string, format: "raw" | "minimal"): Promise<RawMessage | null> {
    try {
      return await this.need().request<RawMessage>(`${API}/messages/${encodeURIComponent(gmailId)}`, { query: { format } });
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 404) return null;
      throw err;
    }
  }

  private parse = async (msg: RawMessage): Promise<NormalizedEmail> => {
    const parsed = await simpleParser(Buffer.from(msg.raw ?? "", "base64url"), { skipImageLinks: true, skipTextToHtml: true });
    const mail = normalizeEmail(parsed, `gmail:${msg.id}`);
    if (!parsed.date && msg.internalDate) mail.sentAt = new Date(Number(msg.internalDate));
    return mail;
  };

  /** A fetched message, parsed and ready to store, or null when it stays out of the app. */
  private async prepare(msg: RawMessage): Promise<{ mail: NormalizedEmail; ctx: EmailContext } | null> {
    const labels = msg.labelIds ?? [];
    if (hidden(labels) || !msg.raw) return null;
    const mail = await this.parse(msg);
    return {
      // Gmail's own conversation ID groups the thread, the way it does in Gmail.
      mail: { ...mail, threadRoot: msg.threadId },
      ctx: {
        role: roleOf(labels),
        meta: { gmail_id: msg.id, thread_id: msg.threadId, labels },
        seen: !labels.includes("UNREAD"),
        selfAddresses: this.selfAddresses,
      },
    };
  }

  private async store(msg: RawMessage) {
    const item = await this.prepare(msg);
    if (!item) return null;
    const stored = await storeEmail(this.account, item.mail, item.ctx);
    if (stored.result === "inserted" && stored.messageId) await saveFilesQuietly(this.id, this.account.user_id, stored.messageId, item.mail.attachments);
    return { ...stored, providerMessageId: item.mail.providerMessageId };
  }

  /**
   * Moves each conversation to where its messages are in Gmail: the Inbox, archived, the Bin or Spam.
   * Spam shows in the app's Junk. Conversations with a change from the app still on its way are left
   * alone, so the history check never undoes an action before Gmail has it.
   */
  private async settleThreads(threadIds: string[], unspammed = new Set<string>()) {
    for (const ids of chunks(threadIds, 100)) {
      // Every page of messages: a conversation judged on only some of them could be archived by mistake.
      const [messages, queued] = await Promise.all([
        allRows(
          (from, to) => db.from("messages").select("thread_id, direction, provider_meta").in("thread_id", ids).eq("account_id", this.id).order("id").range(from, to),
          "load thread labels",
        ),
        allRows(
          (from, to) => db.from("mail_actions").select("thread_id").in("thread_id", ids).in("status", ["queued", "working"]).order("id").range(from, to),
          "check queued actions",
        ),
      ]);
      const byThread = new Map<string, { labels: string[]; direction: string; deleted?: boolean }[]>();
      for (const r of messages) {
        const meta = r.provider_meta as GmailMeta;
        push(byThread, r.thread_id, { labels: meta.labels ?? [], direction: r.direction, deleted: meta.deleted });
      }
      const waiting = new Set(queued.map((r) => r.thread_id));
      const place = new Map(ids.filter((id) => !waiting.has(id)).map((id) => [id, threadPlace(byThread.get(id) ?? [])]));
      const at = (...wanted: string[]) => [...place].filter(([, p]) => wanted.includes(p)).map(([id]) => id);

      // Sent mail has no INBOX label, so a conversation you started here would vanish until someone replies.
      const keep = await startedHere(this.id, at("archived", "gone"));
      const archive = at("archived", "gone").filter((id) => !keep.has(id));
      const untrashed = at("archived").filter((id) => !keep.has(id));
      if (archive.length) must(await db.from("threads").update({ status: "archived" }).in("id", archive).eq("status", "inbox"), "archive threads");
      if (untrashed.length) must(await db.from("threads").update({ status: "archived" }).in("id", untrashed).eq("status", "trash"), "untrash threads");
      const restore = at("inbox");
      if (restore.length) must(await db.from("threads").update({ status: "inbox" }).in("id", restore).in("status", ["archived", "trash"]), "restore threads");
      const binned = at("trash");
      if (binned.length) must(await db.from("threads").update({ status: "trash" }).in("id", binned).in("status", ["inbox", "archived"]), "bin threads");
      const spam = at("spam");
      if (spam.length) {
        must(await db.from("threads").update({ status: "inbox" }).in("id", spam).neq("status", "inbox"), "show spam threads");
        must(await db.from("threads").update({ junk: true }).in("id", spam).eq("junk", false), "mark spam threads");
      }
      const notSpam = at("inbox", "archived").filter((id) => unspammed.has(id));
      if (notSpam.length) must(await db.from("threads").update({ junk: false }).in("id", notSpam).eq("junk", true), "clear spam threads");
    }
  }

  /** Catch-up for attachment files not in storage yet, fetched again from Gmail. Each run takes the next page of rows. */
  private async saveMissingFiles() {
    const messages = new Map<string, string>(); // message ID -> Gmail ID
    for (const r of await this.missingFiles.next()) {
      const gmailId = (r.provider_meta as GmailMeta).gmail_id;
      if (gmailId) messages.set(r.message_id, gmailId);
    }
    let saved = 0;
    await mapLimit([...messages], FETCH_AT_ONCE / 2, async ([messageId, gmailId]) => {
      if (this.stopped) return;
      const msg = await this.fetchMessage(gmailId, "raw");
      if (!msg?.raw) return;
      const mail = await this.parse(msg).catch((err) => void log.warn("attachment upload failed", { account: this.id, code: errorCode(err) }));
      if (mail) saved += await saveFilesQuietly(this.id, this.account.user_id, messageId, mail.attachments);
    });
    if (saved > 0) log.info("attachment files saved", { account: this.id, saved });
  }

  /**
   * Sends one queued reply through Gmail, in the same Gmail conversation, or a new email as a new
   * conversation, then imports the sent copy.
   */
  async send(queuedRow: OutboxRow) {
    accountActivity.mark(this.id); // the app is in use: check this mailbox quickly for a while
    if (!this.ready) return; // still connecting: the next poll retries it
    const row = await claimReady(queuedRow); // waits for its files, then claims it
    if (!row) return;
    const kind = row.thread_id ? "reply" : "email";
    let sentId: string;
    let messageId: string;
    let requested = false; // once the email is on its way, a lost answer does not mean it was not sent
    try {
      const out = await composeOutgoing(row, this.id, this.selfAddresses, "gmail", undefined, false, true); // Gmail reads Bcc from the message and removes it before delivering
      if ("error" in out) {
        await markFailed(row.id, out.error);
        return;
      }
      messageId = out.messageId;
      let threadId: string | undefined;
      if (out.threadId) {
        const thread = must(await db.from("threads").select("provider_thread_id").eq("id", out.threadId).single(), "load gmail thread");
        threadId = thread.provider_thread_id;
      }
      // With files the email is too large for the JSON endpoint, so it goes as bytes to the upload endpoint.
      const upload = out.attachmentCount > 0 ? gmailUploadRequest(out.raw, threadId) : null;
      requested = true;
      const sent = upload
        ? await this.need().request<{ id: string }>(GMAIL_UPLOAD_SEND, {
            method: "POST",
            query: { uploadType: upload.uploadType },
            raw: upload.body,
            timeoutMs: UPLOAD_TIMEOUT_MS,
          })
        : await this.need().request<{ id: string }>(`${API}/messages/send`, {
            method: "POST",
            body: { raw: out.raw.toString("base64url"), ...(threadId ? { threadId } : {}) },
          });
      sentId = sent.id;
    } catch (err) {
      log.warn(`${kind} failed`, { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(
        row.id,
        signInRevoked(err)
          ? `Google sign-in expired, so the ${kind} was not sent. Reconnect Google, then send again.`
          : err instanceof GoogleApiError && err.status === 413
            ? `Gmail refused the ${kind} because it is too large. Remove an attachment, then send again.`
            : requested && !(err instanceof GoogleApiError) && !(err instanceof GoogleAuthError)
              ? `The ${kind} may have been sent. Check your Sent folder before sending again.`
              : `The ${kind} could not be sent. Try again.`,
      ).catch(() => undefined);
      return;
    }
    if (!(await settleSent(row.id, messageId))) log.warn(`${kind} sent but not recorded`, { account: this.id, outbox: row.id });
    else log.info(`${kind} sent`, { account: this.id, outbox: row.id });

    // Show it in the conversation now rather than at the next history check. Gmail may give the sent
    // email its own Message-ID, so the outbox row records the one it actually went out with.
    this.background(async () => {
      const msg = await this.fetchMessage(sentId, "raw");
      const stored = msg && (await this.store(msg));
      if (stored && stored.threadId) await this.settleThreads([stored.threadId]);
      if (stored && stored.providerMessageId !== messageId) {
        must(await db.from("outbox").update({ provider_message_id: stored.providerMessageId }).eq("id", row.id), "save sent message id");
      }
      // A new email: let the app open the conversation it started.
      if (stored && stored.threadId && !row.thread_id) await linkThread(row.id, stored.threadId);
    });
  }

  /** Applies a read, unread, archive, unarchive, delete, undelete, junk or not junk made in the app to the labels in Gmail. */
  async applyAction(row: Tables<"mail_actions">) {
    accountActivity.mark(this.id); // the app is in use: check this mailbox quickly for a while
    if (!this.ready) throw new NotReady(); // still connecting: back to queued, the next poll retries it
    const run = async () => {
      const change = actionLabels(row.action);
      if (!change) throw Object.assign(new Error("unknown action"), { code: "UNKNOWN_ACTION" });
      const messages = must(
        await db
          .from("messages")
          .select("id, direction, provider_meta")
          .eq("thread_id", row.thread_id)
          .eq("account_id", this.id)
          .order("sent_at", { ascending: false }),
        "load action messages",
      )
        .map((m) => ({ id: m.id, inbound: m.direction === "inbound", meta: m.provider_meta as GmailMeta }))
        .filter((m) => m.meta.gmail_id && !m.meta.deleted);
      const has = (m: { meta: GmailMeta }, label: string) => (m.meta.labels ?? []).includes(label);

      let targets = messages;
      // Read touches only unread mail, so messages already read cost no request or write.
      if (row.action === "read") targets = messages.filter((m) => m.inbound && has(m, "UNREAD"));
      // Unread marks only the latest message, as in Gmail.
      else if (row.action === "unread") targets = messages.filter((m) => m.inbound).slice(0, 1);
      // Spam is about mail you received; your own replies stay in Sent. Not Junk only moves mail that is
      // in Spam (junk the AI sorted out never was), and its undo only puts that mail back.
      else if (row.action === "unspam") targets = messages.filter((m) => m.inbound && has(m, "SPAM"));
      else if (row.action === "spam") {
        const undo = await undoesNotJunk(db, row);
        targets = messages.filter((m) => m.inbound && (!undo || m.meta.was_spam));
      }
      if (targets.length === 0) return;

      // Undoing a delete puts messages that were in the Inbox back there, whatever Gmail did with the label.
      const groups =
        row.action === "untrash"
          ? [
              { list: targets.filter((m) => m.meta.was_inbox), add: ["INBOX"], remove: change.remove },
              { list: targets.filter((m) => !m.meta.was_inbox), add: change.add, remove: change.remove },
            ]
          : [{ list: targets, add: change.add, remove: change.remove }];

      for (const { list, add, remove } of groups) {
        if (list.length === 0) continue;
        // Gmail takes at most 1000 messages in one batchModify.
        for (const part of chunks(list, 1000)) {
          await this.need().request(`${API}/messages/batchModify`, {
            method: "POST",
            body: { ids: part.map((m) => m.meta.gmail_id), addLabelIds: add, removeLabelIds: remove },
          });
          await mapLimit(part, WRITE_AT_ONCE, async (m) => {
            const { was_inbox: _, was_spam: __, ...meta } = m.meta;
            const labels = applyLabelChange(meta.labels ?? [], add, remove);
            const next: GmailMeta =
              row.action === "trash"
                ? { ...meta, labels, was_inbox: (meta.labels ?? []).includes("INBOX") }
                : row.action === "unspam"
                  ? { ...meta, labels, was_spam: true }
                  : { ...meta, labels };
            must(await db.from("messages").update({ provider_meta: next }).eq("id", m.id), "save gmail labels");
          });
        }
      }
    };

    try {
      await this.queue.run(run);
    } catch (err) {
      log.warn("mail action failed", { account: this.id, action: row.action, code: errorCode(err) });
      await finishAction(row.id, "Could not update Gmail. It will match on the next change.");
      return;
    }
    await finishAction(row.id);
  }

  /** Unsubscribes from one sender. An unsubscribe email goes out through Gmail. */
  async unsubscribe(row: Tables<"unsubscribes">) {
    accountActivity.mark(this.id); // the app is in use: check this mailbox quickly for a while
    if (!this.ready) return;
    await carryOutUnsubscribe(this.id, row, (mailto) => this.mailtoUnsubscribe(mailto));
  }

  private async mailtoUnsubscribe(mailto: MailtoUnsubscribe) {
    const raw = await new MailComposer({ from: this.account.address, to: mailto.to, subject: mailto.subject, text: mailto.body }).compile().build();
    await this.need().request(`${API}/messages/send`, { method: "POST", body: { raw: raw.toString("base64url") } });
  }

  private need(): GoogleClient {
    if (!this.client) throw Object.assign(new Error("not connected"), { code: "NOT_CONNECTED" });
    return this.client;
  }

  private background(step: () => Promise<void>) {
    this.queue.background(step, (err) => log.warn("gmail background step failed", { account: this.id, code: errorCode(err) }));
  }
}
