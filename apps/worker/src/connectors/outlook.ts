// Outlook and Microsoft 365 mail through Microsoft Graph. Each folder's delta query says what changed
// since the last check. With GRAPH_NOTIFICATION_URL and GRAPH_NOTIFY_SECRET set, a Graph change subscription (created
// and renewed here) posts to the web app's public route, which writes a row to mail_hints; the worker hears it
// (runtime/mail-hints.ts) and runs the delta now, with a slow check (every 5 minutes) as the safety net. Without them
// only the slow check runs. If they are set but the subscription cannot be made, the old cadence returns (the Inbox
// every 5 s while the mailbox is active, backing off to 60 s when quiet; polling.ts). Messages are fetched as MIME, so they are parsed and stored exactly like
// iCloud and Gmail mail, and Outlook's conversation ID groups the thread. Read, unread, archive, delete
// and junk in the app move or flag the mail in Outlook (delete moves it to Deleted Items, never deletes it
// for good). Replies go out through Graph from your Outlook address; Outlook files them in Sent Items.

import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type { Json, Tables } from "@messages/db";
import { Backoff, SerialQueue, Sleeper, sleep, supervise } from "../backoff";
import { accountActivity, OUTLOOK_POLL, OUTLOOK_SIDE_POLL } from "../polling";
import { mailPollDelay, type PushState } from "../runtime/mail-poll";
import { onMailHint } from "../runtime/mail-hints";
import { formatSubscription, parseSubscription, renewalDue, type SavedSubscription } from "../microsoft/graph-notify";
import { ensureMailSubscription } from "../microsoft/subscriptions";
import { allRows, db, getSyncState, must, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { chunks, mapLimit, push } from "../util";
import { normalizeEmail, type EmailAttachment, type NormalizedEmail } from "../ingest/normalize-email";
import { storeEmail, storeEmails, type EmailContext } from "../ingest/store-email";
import { isFailure } from "../ingest/batch-rpc";
import { MissingFiles, saveFilesQuietly } from "../ingest/attachment-files";
import { claimReady, composeOutgoing, freshAccount, linkNewEmails, linkThread, markFailed, settleSent, startedHere, type OutboxRow } from "../send/outbox";
import type { OutgoingAttachment } from "../send/compose";
import { finishAction, NotReady } from "../send/actions";
import { carryOutUnsubscribe, type MailtoUnsubscribe } from "../send/unsubscribe-flow";
import { normAddresses } from "../send/from-address";
import { rememberSendable } from "../send/verified-aliases";
import { authservTrust } from "../ingest/email-auth";

// Only Microsoft's own Authentication-Results count for an Outlook account (ingest/email-auth.ts).
const TRUST_MICROSOFT = authservTrust("outlook");
import { undoesNotJunk } from "../ingest/junk-undo";
import { sealAddress } from "../vault";
import { GraphApiError, putChunk, signInRevoked, type GraphClient } from "../microsoft/client";
import { MAIL_SCOPE, MicrosoftAuthError, SEND_SCOPE } from "../microsoft/oauth";
import { microsoftFatalDetail, openGraphClient } from "../microsoft/session";
import {
  IMPORT_FOLDERS,
  WATCH_FOLDERS,
  foldDeltas,
  outlookMove,
  outlookThreadPlace,
  roleOf,
  type DeltaChanges,
  type DeltaMessage,
  type OutlookFolder,
} from "../microsoft/outlook-place";

const SUBSCRIPTION_SCOPE = "graph_sub"; // sync_state scope holding the subscription id and expiry
const SUBSCRIPTION_RETRY_MS = 5 * 60_000; // a failed subscription is tried again no sooner than this
const MAX_FAILED_CHECKS = 12; // about a minute of checks failing in a row
const DELTAS_AT_ONCE = 3; // folders whose delta is read together
const WRITE_AT_ONCE = 6; // row updates in flight together when many messages change at once
const FETCH_AT_ONCE = 4; // Outlook allows four requests at once per mailbox
const STORE_AT_ONCE = 25; // messages per database call during imports; the next chunk is fetched meanwhile
const SETTLE_AT_ONCE = 100; // conversations placed together during an import
const PROGRESS_EVERY = 500;
const KNOWN_IDS_AT_ONCE = 30; // Graph IDs per lookup query (they go in the URL)
const FILES_EVERY_MS = 10 * 60_000;
const FILES_AT_ONCE = 200; // attachment rows checked per catch-up
const PAGE_SIZE = 200; // messages per delta page
/** Fields read from each message in a delta. Everything else comes from the MIME. */
const SELECT = "id,conversationId,isRead,isDraft,receivedDateTime";
/** Graph takes files up to 3 MB inside a request; larger ones go through an upload session. */
const INLINE_FILE_BYTES = 3 * 1024 * 1024;
/** Upload session pieces must be multiples of 320 KiB. This is twelve of them, under 4 MB. */
const CHUNK_BYTES = 12 * 320 * 1024;
const SEND_TIMEOUT_MS = 5 * 60_000;
/** After a send, how long to wait each time before looking for the copy in Sent Items. */
const SENT_COPY_WAITS_MS = [2_000, 5_000, 10_000];

// A type, not an interface, so it counts as JSON for the provider_meta column.
type OutlookMeta = {
  graph_id?: string;
  conversation_id?: string | null;
  /** The folder it is in, or null once it left the folders followed here. */
  folder?: OutlookFolder | null;
  /** Whether Outlook has it as read, so marking a conversation read touches only unread mail. */
  read?: boolean;
  /** Where the app moved it from, for an exact undo of delete and Not Junk. */
  from?: OutlookFolder;
};

/** A stored message as a delta check compares it with Outlook. */
interface KnownMessage {
  id: string;
  threadId: string;
  direction: string;
  isRead: boolean;
  meta: OutlookMeta;
}

/** A message to import: where it is and what the delta said about it. */
interface ToImport {
  id: string;
  folder: OutlookFolder;
  isRead: boolean;
  conversationId: string | null;
  receivedAt: string | null;
}

/** Graph's time format for a filter, without milliseconds. */
function graphTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class OutlookConnector {
  private client: GraphClient | null = null;
  private stopped = false;
  private ready = false;
  private canSend = false;
  /** Whether the mailbox has an Archive folder. Older Exchange mailboxes can lack one. */
  private hasArchive = true;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  /** Changes are applied one at a time, so a delta check never races an action from the app. */
  private readonly queue = new SerialQueue();
  private selfAddresses = new Set<string>();
  /** Where each folder's delta was last read up to. Loaded once per session, then kept here. */
  private readonly deltaLinks = new Map<OutlookFolder, string>();
  /** Attachment rows with no stored file yet, a page per catch-up. */
  private readonly missingFiles: MissingFiles;
  /** Whether Graph push is off, working or failing for this session; it picks the check cadence (runtime/mail-poll.ts). */
  private pushState: PushState = "off";
  private subscription: SavedSubscription | null = null;
  /** Set by a hint from the web app: one that lands during a check must not be lost, as an interrupt would be. */
  private hinted = false;

  constructor(private readonly account: AccountRow) {
    this.missingFiles = new MissingFiles(account.id, FILES_AT_ONCE);
  }

  get id() {
    return this.account.id;
  }

  start() {
    void supervise(() => this.run(), () => this.stopped, (err) => log.error("outlook run loop failed", { account: this.id, code: errorCode(err) }));
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
        // A revoked sign-in, a missing Microsoft app or mail not granted: retrying cannot fix these, so
        // stop until the connect command or a restart does.
        const fatal = microsoftFatalDetail(err, "Mail");
        if (fatal) {
          if (signInRevoked(err)) log.error("outlook sign-in revoked", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", fatal).catch(() => undefined);
          return;
        }
        log.warn("outlook session failed", { account: this.id, code: errorCode(err) });
        await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
      }
      this.ready = false;
      if (this.stopped) break;
      const delay = this.backoff.next();
      log.info("outlook reconnecting", { account: this.id, inMs: delay });
      await this.sleeper.wait(delay);
    }
  }

  /** One session: catch up on every folder, then check the Inbox (5 s active, 30 s, 60 s) and the other folders (20 s, 2 min, 5 min). */
  private async session() {
    await setAccountStatus(this.id, "connecting");
    const { client, creds } = await openGraphClient(this.id, [MAIL_SCOPE]);
    this.client = client;
    this.canSend = creds.scopes.includes(SEND_SCOPE);
    this.queue.reset();
    this.pushState = "off";
    this.subscription = null;
    this.hinted = false;

    const [me, archive] = await Promise.all([
      client.request<{ mail?: string | null; userPrincipalName?: string | null; proxyAddresses?: string[] }>("/me", {
        query: { $select: "mail,userPrincipalName,proxyAddresses" },
      }),
      client.request("/me/mailFolders/archive", { query: { $select: "id" } }).then(
        () => true,
        (err) => {
          if (err instanceof GraphApiError && err.status === 404) return false;
          throw err;
        },
      ),
    ]);
    this.hasArchive = archive;
    // Mail is sent from the account's own address. Its other addresses (a work account's proxy
    // addresses) still count as you, so mail sent from them shows as yours.
    const sendable = normAddresses([this.account.address]);
    const others = normAddresses([
      me.mail,
      me.userPrincipalName?.includes("@") ? me.userPrincipalName : null,
      ...(me.proxyAddresses ?? []).filter((a) => /^smtp:/i.test(a)).map((a) => a.slice(5)),
    ]);
    const current = (await freshAccount(this.id)).send_addresses;
    if (current.length !== sendable.length || current.some((a, i) => a !== sendable[i])) {
      const stored = await Promise.all(sendable.map((a) => sealAddress(this.account.user_id, a)));
      must(await db.from("accounts").update({ send_addresses: stored }).eq("id", this.id), "save send addresses");
    }
    rememberSendable(this.id, sendable); // what a send may use as From (send/verified-aliases.ts)
    this.selfAddresses = new Set([...sendable, ...others]);
    log.info("outlook connected", { account: this.id, addresses: this.selfAddresses.size, archive: this.hasArchive });

    await setAccountStatus(this.id, "syncing");
    this.deltaLinks.clear();
    for (const folder of this.folders()) {
      const state = await getSyncState(this.id, `delta:${folder}`);
      if (state?.sync_token) this.deltaLinks.set(folder, state.sync_token);
    }
    await this.queue.run(() => this.catchUp(this.folders()));
    this.backoff.reset(); // only once the first sync worked: a sync that always fails must keep backing off
    await setAccountStatus(this.id, "connected");
    this.ready = true;
    this.background(() => this.saveMissingFiles());

    let lastFiles = Date.now();
    let lastTouch = Date.now();
    let failures = 0;
    let lastSide = Date.now();
    let lastSubTry = 0;
    const pushUrl = process.env.GRAPH_NOTIFICATION_URL?.trim();
    const pushSecret = process.env.GRAPH_NOTIFY_SECRET?.trim();
    const pushOn = !!pushUrl && !!pushSecret;
    accountActivity.mark(this.id); // a new session starts with quick checks
    // Work the app does for this account (a send, an action) ends an idle wait early.
    const wakeOnActivity = accountActivity.onMark(this.id, () => this.sleeper.interrupt());
    // Push: a hint for this account (a change notification Graph sent the web app) wakes the check at once.
    const unhint = pushOn ? onMailHint(this.id, () => { this.hinted = true; this.sleeper.interrupt(); }) : () => undefined;
    try {
      while (!this.stopped) {
        if (pushOn && renewalDue(this.subscription, Date.now()) && Date.now() - lastSubTry >= SUBSCRIPTION_RETRY_MS) {
          lastSubTry = Date.now();
          await this.keepSubscription(pushUrl, pushSecret);
        }
        // Push on or off: the slow check (5 minutes). Push configured but failing: the Inbox every 5 s while this
        // mailbox is active, backing off to 30 s then 60 s (polling.ts). A failed check retries quickly, and a hint
        // skips the wait.
        const hinted = this.hinted;
        if (!hinted) {
          await this.sleeper.wait(failures > 0 ? OUTLOOK_POLL.activeMs : mailPollDelay(this.pushState, OUTLOOK_POLL, accountActivity.since(this.id), Date.now()));
        }
        this.hinted = false;
        if (this.stopped) break;
        // The other folders follow their own slower cadence (20 s, 2 minutes, 5 minutes), but a hint means something
        // changed somewhere in the mailbox, so everything is read.
        const allDue = hinted || Date.now() - lastSide >= accountActivity.delay(this.id, OUTLOOK_SIDE_POLL);
        if (allDue) lastSide = Date.now();
        const folders: OutlookFolder[] = allDue ? this.folders() : ["inbox"];
        // One failed check (Graph throttling, a database hiccup) is retried at the next one rather than
        // ending the session. A revoked sign-in ends it at once, and a minute of failures in a row ends it
        // too, so the reconnect (with backoff) takes over instead of logging forever.
        try {
          await this.queue.run(() => this.catchUp(folders));
          failures = 0;
        } catch (err) {
          if (signInRevoked(err) || ++failures >= MAX_FAILED_CHECKS) throw err;
          log.warn("outlook delta check failed", { account: this.id, code: errorCode(err), failures });
        }
        if (Date.now() - lastTouch > 60_000) {
          lastTouch = Date.now();
          await touchAccount(this.id);
          // A new email whose sent copy arrived through a delta check rather than right after sending.
          await linkNewEmails(this.id).catch((err) => log.warn("link new emails failed", { account: this.id, code: errorCode(err) }));
        }
        if (Date.now() - lastFiles > FILES_EVERY_MS) {
          lastFiles = Date.now();
          this.background(() => this.saveMissingFiles());
        }
      }
    } finally {
      wakeOnActivity();
      unhint();
    }
  }

  /**
   * Creates or renews this mailbox's Graph subscription. A failure only means the old cadence returns; it never ends
   * the session. A subscription made now sets a hint, so mail that arrived before it existed is read once.
   */
  private async keepSubscription(url: string, secret: string) {
    try {
      this.subscription ??= parseSubscription((await getSyncState(this.id, SUBSCRIPTION_SCOPE))?.sync_token);
      const { sub, changed } = await ensureMailSubscription(this.need(), { accountId: this.id, url, secret, saved: this.subscription });
      this.subscription = sub;
      this.pushState = "healthy";
      if (changed) {
        await saveSyncState(this.id, SUBSCRIPTION_SCOPE, { sync_token: formatSubscription(sub) });
        this.hinted = true;
      }
    } catch (err) {
      if (signInRevoked(err)) throw err;
      this.pushState = "failing";
      log.warn("outlook subscription failed", { account: this.id, code: errorCode(err) });
    }
  }

  /** Every folder followed in this mailbox. */
  private folders(): OutlookFolder[] {
    return [...IMPORT_FOLDERS, ...WATCH_FOLDERS].filter((f) => f !== "archive" || this.hasArchive);
  }

  /**
   * Reads what changed in these folders and applies it. A folder with no saved position (the first sync)
   * or whose position Outlook no longer knows starts again from the last 30 days, skipping mail the app
   * already has. Positions are saved only once the changes are stored, so a failure reads them again.
   */
  private async catchUp(folders: OutlookFolder[]) {
    const links = new Map<OutlookFolder, string>();
    let fresh = false; // a folder read from the start of the window, for progress logging
    // Folders are read a few at a time (Graph allows four requests at once), in the order given.
    const read = await mapLimit(folders, DELTAS_AT_ONCE, async (folder) => {
      if (this.stopped) return null;
      const start = this.deltaLinks.get(folder);
      if (!start) fresh = true;
      let result: { messages: DeltaMessage[]; deltaLink: string };
      try {
        result = await this.readDelta(folder, start);
      } catch (err) {
        if (!start || !(err instanceof GraphApiError) || (err.status !== 410 && err.graphCode !== "SyncStateNotFound")) throw err;
        log.warn("outlook delta expired", { account: this.id, folder });
        fresh = true;
        result = await this.readDelta(folder);
      }
      links.set(folder, result.deltaLink);
      return { folder, messages: result.messages };
    });
    if (this.stopped) return;
    const rounds = read.filter((r) => r !== null);
    const changes = foldDeltas(rounds);
    if (changes.seen.size > 0 || changes.left.size > 0) accountActivity.mark(this.id); // mail changed: keep checking quickly for a while
    await this.applyChanges(changes, fresh);
    for (const [folder, link] of links) {
      if (link === this.deltaLinks.get(folder)) continue;
      await saveSyncState(this.id, `delta:${folder}`, { sync_token: link });
      this.deltaLinks.set(folder, link);
    }
  }

  /** Every page of one folder's delta: from the saved position, or from the start of the sync window. */
  private async readDelta(folder: OutlookFolder, from?: string): Promise<{ messages: DeltaMessage[]; deltaLink: string }> {
    const client = this.need();
    const messages: DeltaMessage[] = [];
    const since = graphTime(Date.now() - env.initialSyncDays * 86_400_000);
    let page = await client.request<{ value?: DeltaMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }>(
      from ?? `/me/mailFolders/${folder}/messages/delta`,
      { query: from ? undefined : { $select: SELECT, $filter: `receivedDateTime ge ${since}` }, prefer: [`odata.maxpagesize=${PAGE_SIZE}`] },
    );
    for (;;) {
      messages.push(...(page.value ?? []));
      const next = page["@odata.nextLink"];
      if (!next) break;
      if (this.stopped) throw Object.assign(new Error("stopped"), { code: "STOPPED" });
      page = await client.request(next, { prefer: [`odata.maxpagesize=${PAGE_SIZE}`] });
    }
    const deltaLink = page["@odata.deltaLink"];
    if (!deltaLink) throw Object.assign(new Error("no delta link"), { code: "NO_DELTA_LINK" });
    return { messages, deltaLink };
  }

  private async applyChanges(changes: DeltaChanges, fresh: boolean) {
    const ids = [...new Set([...changes.seen.keys(), ...changes.left.keys()])];
    const known = await this.knownMessages(ids);
    const touched = new Set<string>(); // conversations to settle
    const changed = new Set<string>(); // conversations whose stored messages changed here, to refresh

    // New to the app, oldest first. Drafts stay out, and mail first seen in Junk or Deleted Items does too.
    const todo: ToImport[] = [...changes.seen]
      .filter(([id, m]) => !known.has(id) && !m.isDraft && IMPORT_FOLDERS.includes(m.folder))
      .map(([id, m]) => ({ id, folder: m.folder, isRead: m.isRead, conversationId: m.conversationId, receivedAt: m.receivedAt }))
      .sort((a, b) => (a.receivedAt ?? "").localeCompare(b.receivedAt ?? ""));
    // Conversations are placed as their mail is stored, a hundred at a time, so an import that stops
    // early leaves none of them unplaced.
    const settle = async () => {
      await this.settleThreads([...touched]);
      touched.clear();
    };
    let processed = 0;
    let inserted: number;
    try {
      inserted = await this.importMessages(todo, touched, async (count) => {
        if (touched.size >= SETTLE_AT_ONCE) await settle();
        if (fresh && Math.floor((processed + count) / PROGRESS_EVERY) > Math.floor(processed / PROGRESS_EVERY)) {
          log.info("outlook import progress", { account: this.id, processed: processed + count, of: todo.length });
        }
        processed += count;
      });
    } catch (err) {
      await settle().catch(() => undefined);
      throw err;
    }

    // Mail the app has that moved folder or changed read state.
    const unjunked = new Set<string>(); // conversations taken out of Junk in Outlook
    const writes: { row: KnownMessage; patch: { provider_meta: OutlookMeta; is_read?: boolean } }[] = [];
    for (const [id, m] of changes.seen) {
      const row = known.get(id);
      if (!row) continue;
      touched.add(row.threadId);
      const isRead = row.direction === "inbound" ? m.isRead : row.isRead;
      // Often just the echo of an action from the app, which stored the new state already.
      if (row.meta.folder === m.folder && row.meta.read === m.isRead && isRead === row.isRead) continue;
      if (row.meta.folder === "junkemail" && m.folder !== "junkemail") unjunked.add(row.threadId);
      // A move made in Outlook ends what the app remembered about where the message came from.
      const { from: _from, ...meta } = row.meta;
      const patch: { provider_meta: OutlookMeta; is_read?: boolean } = {
        provider_meta: { ...(row.meta.folder === m.folder ? row.meta : meta), folder: m.folder, read: m.isRead },
      };
      if (row.direction === "inbound") patch.is_read = isRead;
      writes.push({ row, patch });
    }
    await mapLimit(writes, WRITE_AT_ONCE, async ({ row, patch }) => {
      must(await db.from("messages").update(patch).eq("id", row.id), "update outlook message");
      changed.add(row.threadId);
    });
    const moved = writes.length;

    // Left a followed folder for one of your own, or deleted for good: the app keeps its copy, archived.
    const gone: KnownMessage[] = [];
    for (const [id, folder] of changes.left) {
      const row = known.get(id);
      if (!row || row.meta.folder !== folder) continue;
      touched.add(row.threadId);
      gone.push(row);
    }
    await mapLimit(gone, WRITE_AT_ONCE, async (row) => {
      must(await db.from("messages").update({ provider_meta: { ...row.meta, folder: null } }).eq("id", row.id), "mark outlook message gone");
      changed.add(row.threadId);
    });

    await mapLimit([...changed], WRITE_AT_ONCE, async (threadId) => {
      must(await db.rpc("refresh_thread", { p_thread_id: threadId }), "refresh thread");
    });
    await this.settleThreads([...touched], unjunked);
    if (inserted || moved || changes.left.size) {
      log.info("outlook changes applied", { account: this.id, inserted, moved, left: changes.left.size });
    }
  }

  /** Stored messages among these Graph IDs, keyed by Graph ID. */
  private async knownMessages(graphIds: string[]) {
    const out = new Map<string, KnownMessage>();
    // Graph IDs are ~150 characters and go in the URL, so 100 at once is a ~16 KB request line some proxies refuse.
    for (const ids of chunks(graphIds, KNOWN_IDS_AT_ONCE)) {
      const rows = must(
        await db
          .from("messages")
          .select("id, thread_id, direction, is_read, provider_meta")
          .eq("account_id", this.id)
          .in("provider_meta->>graph_id", ids),
        "load known outlook messages",
      );
      for (const r of rows) {
        const meta = r.provider_meta as OutlookMeta;
        if (meta.graph_id) out.set(meta.graph_id, { id: r.id, threadId: r.thread_id, direction: r.direction, isRead: r.is_read, meta });
      }
    }
    return out;
  }

  /**
   * Fetches and stores messages in order, a chunk per database call. Each chunk is fetched a few messages
   * at a time while the chunk before it is stored. A message that cannot be stored does not stop the rest;
   * the first such failure is thrown at the end, so the delta position does not move past it.
   */
  private async importMessages(list: ToImport[], touched: Set<string>, afterChunk?: (count: number) => Promise<void>): Promise<number> {
    const fetchChunk = (items: ToImport[]) => {
      const fetching = mapLimit(items, FETCH_AT_ONCE, async (item) => {
        const raw = await this.fetchMime(item.id);
        return raw && (await this.prepare(item, raw));
      });
      fetching.catch(() => undefined); // awaited below; this keeps one left unused by a stop or failure quiet
      return fetching;
    };
    const batches = chunks(list, STORE_AT_ONCE);
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
      log.warn("outlook messages not stored", { account: this.id, failed, inserted });
      throw Object.assign(new Error("message not stored"), { code: failure });
    }
    return inserted;
  }

  /** A message's files, fetched again for one the owner opened (ingest/fetch-requests.ts). null when Outlook no longer has the message. */
  async attachmentsOf(meta: Json): Promise<EmailAttachment[] | null> {
    const graphId = (meta as OutlookMeta | null)?.graph_id;
    const raw = graphId ? await this.fetchMime(graphId) : null;
    return raw && graphId ? (await this.parse(graphId, raw, null)).attachments : null;
  }

  /** One message as MIME, or null when Outlook no longer has it. */
  private async fetchMime(graphId: string): Promise<Buffer | null> {
    try {
      return await this.need().bytes(`/me/messages/${encodeURIComponent(graphId)}/$value`, { timeoutMs: 120_000 });
    } catch (err) {
      if (err instanceof GraphApiError && err.status === 404) return null;
      throw err;
    }
  }

  private async parse(graphId: string, raw: Buffer, receivedAt: string | null): Promise<NormalizedEmail> {
    const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
    const mail = normalizeEmail(parsed, `outlook:${graphId}`, TRUST_MICROSOFT);
    if (!parsed.date && receivedAt) mail.sentAt = new Date(receivedAt);
    return mail;
  }

  /** A fetched message, parsed and ready to store. */
  private async prepare(item: ToImport, raw: Buffer): Promise<{ mail: NormalizedEmail; ctx: EmailContext }> {
    const mail = await this.parse(item.id, raw, item.receivedAt);
    return {
      // Outlook's own conversation ID groups the thread, the way it does in Outlook.
      mail: item.conversationId ? { ...mail, threadRoot: item.conversationId } : mail,
      ctx: {
        role: roleOf(item.folder),
        meta: { graph_id: item.id, conversation_id: item.conversationId, folder: item.folder, read: item.isRead },
        seen: item.isRead,
        selfAddresses: this.selfAddresses,
      },
    };
  }

  private async store(item: ToImport) {
    const raw = await this.fetchMime(item.id);
    if (!raw) return null;
    const prepared = await this.prepare(item, raw);
    const stored = await storeEmail(this.account, prepared.mail, prepared.ctx);
    if (stored.result === "inserted" && stored.messageId) await saveFilesQuietly(this.id, this.account.user_id, stored.messageId, prepared.mail.attachments);
    return { ...stored, providerMessageId: prepared.mail.providerMessageId };
  }

  /**
   * An email as it was sent, for View Original: its HTML, null when it has none, or "missing" when Outlook
   * no longer has it. Fetched on request rather than stored.
   */
  async original(meta: Json): Promise<string | null | "missing"> {
    const graphId = (meta as OutlookMeta | null)?.graph_id;
    if (!graphId) return "missing";
    const raw = await this.fetchMime(graphId);
    if (!raw) return "missing";
    return (await this.parse(graphId, raw, null)).html;
  }

  /**
   * Moves each conversation to where its messages are in Outlook: the Inbox, archived, Deleted Items or
   * Junk. Junk shows in the app's Junk. Conversations with a change from the app still on its way are left
   * alone, so a delta check never undoes an action before Outlook has it.
   */
  private async settleThreads(threadIds: string[], unjunked = new Set<string>()) {
    for (const ids of chunks(threadIds, 100)) {
      // Every page of messages: a conversation judged on only some of them could be archived by mistake.
      const [messages, queued] = await Promise.all([
        allRows(
          (from, to) => db.from("messages").select("thread_id, direction, provider_meta").in("thread_id", ids).eq("account_id", this.id).order("id").range(from, to),
          "load thread folders",
        ),
        allRows(
          (from, to) => db.from("mail_actions").select("thread_id").in("thread_id", ids).in("status", ["queued", "working"]).order("id").range(from, to),
          "check queued actions",
        ),
      ]);
      const byThread = new Map<string, { folder: OutlookFolder | null | undefined; direction: string }[]>();
      for (const r of messages) push(byThread, r.thread_id, { folder: (r.provider_meta as OutlookMeta).folder, direction: r.direction });
      const waiting = new Set(queued.map((r) => r.thread_id));
      const place = new Map(ids.filter((id) => !waiting.has(id)).map((id) => [id, outlookThreadPlace(byThread.get(id) ?? [], this.hasArchive)]));
      const at = (...wanted: string[]) => [...place].filter(([, p]) => wanted.includes(p)).map(([id]) => id);

      // Sent mail is not in the Inbox, so a conversation you started here would vanish until someone replies.
      const keep = await startedHere(this.id, at("archived"));
      const archive = at("archived").filter((id) => !keep.has(id));
      if (archive.length) {
        must(await db.from("threads").update({ status: "archived" }).in("id", archive).eq("status", "inbox"), "archive threads");
        must(await db.from("threads").update({ status: "archived" }).in("id", archive).eq("status", "trash"), "untrash threads");
      }
      const restore = at("inbox");
      if (restore.length) must(await db.from("threads").update({ status: "inbox" }).in("id", restore).in("status", ["archived", "trash"]), "restore threads");
      const binned = at("trash");
      if (binned.length) must(await db.from("threads").update({ status: "trash" }).in("id", binned).in("status", ["inbox", "archived"]), "bin threads");
      const junk = at("spam");
      if (junk.length) {
        must(await db.from("threads").update({ status: "inbox" }).in("id", junk).neq("status", "inbox"), "show junk threads");
        must(await db.from("threads").update({ junk: true }).in("id", junk).eq("junk", false), "mark junk threads");
      }
      const notJunk = at("inbox", "archived").filter((id) => unjunked.has(id));
      if (notJunk.length) must(await db.from("threads").update({ junk: false }).in("id", notJunk).eq("junk", true), "clear junk threads");
    }
  }

  /** Catch-up for attachment files not in storage yet, fetched again from Outlook. Each run takes the next page of rows. */
  private async saveMissingFiles() {
    const messages = new Map<string, string>(); // message ID -> Graph ID
    for (const r of await this.missingFiles.next()) {
      const graphId = (r.provider_meta as OutlookMeta).graph_id;
      if (graphId) messages.set(r.message_id, graphId);
    }
    let saved = 0;
    await mapLimit([...messages], FETCH_AT_ONCE / 2, async ([messageId, graphId]) => {
      if (this.stopped) return;
      const raw = await this.fetchMime(graphId);
      if (!raw) return;
      const mail = await this.parse(graphId, raw, null).catch((err) => void log.warn("attachment upload failed", { account: this.id, code: errorCode(err) }));
      if (mail) saved += await saveFilesQuietly(this.id, this.account.user_id, messageId, mail.attachments);
    });
    if (saved > 0) log.info("attachment files saved", { account: this.id, saved });
  }

  /**
   * Sends one queued reply or new email through Outlook, then imports the sent copy. The email goes as
   * MIME, so its threading headers are the ones every provider uses. Without files it is one request.
   * With files it is saved as a draft first, the files are added to it (large ones in pieces), and the
   * draft is sent: Graph takes at most 4 MB in one request.
   */
  async send(queuedRow: OutboxRow) {
    accountActivity.mark(this.id); // the app is in use: check this mailbox quickly for a while
    if (!this.ready) return; // still connecting: the next poll retries it
    const row = await claimReady(queuedRow); // waits for its files, then claims it
    if (!row) return;
    const kind = row.thread_id ? "reply" : "email";
    if (!this.canSend) {
      await markFailed(row.id, `Sending was not allowed when Microsoft was connected, so the ${kind} was not sent. Reconnect Microsoft in Settings, Accounts.`);
      return;
    }
    let messageId: string;
    let requested = false; // once the email is on its way, a lost answer does not mean it was not sent
    let draftId: string | null = null;
    try {
      const out = await composeOutgoing(row, this.id, this.selfAddresses, "outlook", undefined, true, true); // Graph reads Bcc from the message and removes it before delivering
      if ("error" in out) {
        await markFailed(row.id, out.error);
        return;
      }
      messageId = out.messageId;
      const mime = { contentType: "text/plain", data: out.raw.toString("base64") };
      const client = this.need();
      if (out.files.length === 0) {
        requested = true;
        await client.request("/me/sendMail", { method: "POST", raw: mime, timeoutMs: SEND_TIMEOUT_MS });
      } else {
        const draft = await client.request<{ id: string }>("/me/messages", { method: "POST", raw: mime });
        draftId = draft.id;
        for (const file of out.files) await this.attach(draft.id, file);
        requested = true;
        await client.request(`/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST", timeoutMs: SEND_TIMEOUT_MS });
      }
    } catch (err) {
      log.warn(`${kind} failed`, { account: this.id, outbox: row.id, code: errorCode(err) });
      // Failed before the send was asked for: the draft would sit in Drafts for good, so remove it. Once the send
      // was asked for, the draft may be the sent mail, so it is never touched.
      if (draftId && !requested) {
        await this.client?.request(`/me/messages/${encodeURIComponent(draftId)}`, { method: "DELETE" }).catch(() => undefined);
      }
      const code = err instanceof GraphApiError ? err.graphCode : null;
      await markFailed(
        row.id,
        signInRevoked(err)
          ? `Microsoft sign-in expired, so the ${kind} was not sent. Reconnect Microsoft, then send again.`
          : err instanceof GraphApiError && (err.status === 413 || code === "ErrorMessageSizeExceeded")
            ? `Outlook refused the ${kind} because it is too large. Remove an attachment, then send again.`
            : code === "ErrorSendAsDenied"
              ? `Outlook would not send the ${kind} from this address.`
              : requested && !(err instanceof GraphApiError) && !(err instanceof MicrosoftAuthError)
                ? `The ${kind} may have been sent. Check your Sent Items before sending again.`
                : `The ${kind} could not be sent. Try again.`,
      ).catch(() => undefined);
      return;
    }
    if (!(await settleSent(row.id, messageId))) log.warn(`${kind} sent but not recorded`, { account: this.id, outbox: row.id });
    else log.info(`${kind} sent`, { account: this.id, outbox: row.id });

    // Show it in the conversation now rather than at the next delta check. Sending answers with no ID,
    // so the copy is found in Sent Items by its Message-ID.
    void this.storeSentCopy(row, messageId).catch((err) => log.warn("sent copy not stored", { account: this.id, code: errorCode(err) }));
  }

  /** Adds one file to a draft: in the request when small, through an upload session when not. */
  private async attach(draftId: string, file: OutgoingAttachment) {
    const client = this.need();
    const base = `/me/messages/${encodeURIComponent(draftId)}/attachments`;
    if (file.content.length < INLINE_FILE_BYTES) {
      await client.request(base, {
        method: "POST",
        body: { "@odata.type": "#microsoft.graph.fileAttachment", name: file.filename, contentType: file.contentType, contentBytes: file.content.toString("base64") },
      });
      return;
    }
    const session = await client.request<{ uploadUrl: string }>(`${base}/createUploadSession`, {
      method: "POST",
      body: { AttachmentItem: { attachmentType: "file", name: file.filename, size: file.content.length, contentType: file.contentType } },
    });
    for (let start = 0; start < file.content.length; start += CHUNK_BYTES) {
      await putChunk(session.uploadUrl, file.content.subarray(start, start + CHUNK_BYTES), start, file.content.length);
    }
  }

  /** Looks for a sent email in Sent Items a few times, and stores it once Outlook has filed it. */
  private async storeSentCopy(row: OutboxRow, messageId: string) {
    for (const wait of SENT_COPY_WAITS_MS) {
      await sleep(wait);
      if (this.stopped) return;
      let found = false;
      await this.queue.run(async () => {
        const page = await this.need().request<{ value?: DeltaMessage[] }>("/me/mailFolders/sentitems/messages", {
          query: { $filter: `internetMessageId eq '${messageId.replace(/'/g, "''")}'`, $select: SELECT, $top: 1 },
        });
        const msg = page.value?.[0];
        if (!msg) return;
        found = true;
        const stored = await this.store({ id: msg.id, folder: "sentitems", isRead: true, conversationId: msg.conversationId ?? null, receivedAt: msg.receivedDateTime ?? null });
        if (!stored?.threadId) return;
        await this.settleThreads([stored.threadId]);
        if (stored.providerMessageId !== messageId) {
          must(await db.from("outbox").update({ provider_message_id: stored.providerMessageId }).eq("id", row.id), "save sent message id");
        }
        // A new email: let the app open the conversation it started.
        if (!row.thread_id) await linkThread(row.id, stored.threadId);
      });
      if (found) return;
    }
  }

  /** Applies a read, unread, archive, unarchive, delete, undelete, junk or not junk made in the app to the mail in Outlook. */
  async applyAction(row: Tables<"mail_actions">) {
    accountActivity.mark(this.id); // the app is in use: check this mailbox quickly for a while
    if (!this.ready) throw new NotReady(); // still connecting: back to queued, the next poll retries it
    const run = async () => {
      const client = this.need();
      const messages = must(
        await db
          .from("messages")
          .select("id, direction, provider_meta")
          .eq("thread_id", row.thread_id)
          .eq("account_id", this.id)
          .order("sent_at", { ascending: false }),
        "load action messages",
      )
        .map((m) => ({ id: m.id, inbound: m.direction === "inbound", meta: m.provider_meta as OutlookMeta }))
        .filter((m) => m.meta.graph_id && m.meta.folder);

      if (row.action === "read" || row.action === "unread") {
        // Read touches only mail Outlook has as unread; unread marks only the latest message, as in Outlook.
        const read = row.action === "read";
        const targets = read ? messages.filter((m) => m.inbound && m.meta.read === false) : messages.filter((m) => m.inbound).slice(0, 1);
        await mapLimit(targets, FETCH_AT_ONCE, async (m) => {
          await client.request(`/me/messages/${encodeURIComponent(m.meta.graph_id!)}`, { method: "PATCH", body: { isRead: read } });
          must(await db.from("messages").update({ provider_meta: { ...m.meta, read } }).eq("id", m.id), "save outlook read state");
        });
        return;
      }

      const move = outlookMove(row.action, this.hasArchive);
      if (!move) throw Object.assign(new Error("unknown action"), { code: "UNKNOWN_ACTION" });
      if ("missing" in move) throw Object.assign(new Error("missing folder"), { code: `NO_${move.missing.toUpperCase()}` });
      // Undoing Not Junk only puts back mail that Not Junk took out of Junk; junk the AI sorted out stays put.
      const undo = await undoesNotJunk(db, row);
      // Junk is about mail you received; your own replies stay in Sent Items.
      const targets = messages.filter(
        (m) =>
          move.from.includes(m.meta.folder!) &&
          (row.action !== "spam" || m.inbound) &&
          (!undo || m.meta.from === "junkemail"),
      );
      await mapLimit(targets, FETCH_AT_ONCE, async (m) => {
        const to = move.to(m.meta.from);
        if (to === m.meta.folder) return;
        // With immutable IDs the message keeps its ID in the new folder.
        await client.request(`/me/messages/${encodeURIComponent(m.meta.graph_id!)}/move`, { method: "POST", body: { destinationId: to } });
        const { from: _from, ...meta } = m.meta;
        const next: OutlookMeta = { ...meta, folder: to, ...(move.remember ? { from: m.meta.folder! } : {}) };
        must(await db.from("messages").update({ provider_meta: next }).eq("id", m.id), "save moved message");
      });
    };

    try {
      await this.queue.run(run);
      await finishAction(row.id);
    } catch (err) {
      log.warn("mail action failed", { account: this.id, action: row.action, code: errorCode(err) });
      const code = (err as { code?: string }).code;
      await finishAction(row.id, code === "NO_ARCHIVE" ? "This Outlook mailbox has no Archive folder." : "Could not update Outlook. It will match on the next change.");
    }
  }

  /** Unsubscribes from one sender. An unsubscribe email goes out through Outlook. */
  async unsubscribe(row: Tables<"unsubscribes">) {
    accountActivity.mark(this.id); // the app is in use: check this mailbox quickly for a while
    if (!this.ready) return;
    await carryOutUnsubscribe(this.id, row, (mailto) => this.mailtoUnsubscribe(mailto));
  }

  private async mailtoUnsubscribe(mailto: MailtoUnsubscribe) {
    if (!this.canSend) throw Object.assign(new Error("send not granted"), { code: "NOT_GRANTED" });
    const raw = await new MailComposer({ from: this.account.address, to: mailto.to, subject: mailto.subject, text: mailto.body }).compile().build();
    await this.need().request("/me/sendMail", { method: "POST", raw: { contentType: "text/plain", data: raw.toString("base64") } });
  }

  private need(): GraphClient {
    if (!this.client) throw Object.assign(new Error("not connected"), { code: "NOT_CONNECTED" });
    return this.client;
  }

  private background(step: () => Promise<void>) {
    this.queue.background(step, (err) => log.warn("outlook background step failed", { account: this.id, code: errorCode(err) }));
  }
}
