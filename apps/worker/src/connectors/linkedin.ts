import type { Tables } from "@messages/db";
import { addressIndex, chatIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { Backoff, SerialQueue, Sleeper } from "../backoff";
import { db, getSyncState, loadCredentials, must, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { finishAction } from "../send/actions";
import { claimReady, markFailed, settleSent, type OutboxRow } from "../send/outbox";
import { keysFor, open, openAddresses, seal, sealAddress } from "../vault";
import { Helper, HelperError, helperBuilt, spawnTransport, type HelperEvent, type LinkedInConversation, type LinkedInMessage, type LinkedInPerson, type Transport } from "../linkedin/helper";
import { ingestPayload, skipConversation, stubConversation, unreadUrns, type Sealer } from "../linkedin/mapping";
import { NO_COOKIES, NOT_BUILT, PushBack, RECONNECTING, SIGNED_OUT, outcomeOf, surelyNotSent, type Outcome } from "../linkedin/policy";

// LinkedIn messages, through the LinkedIn helper (apps/linkedin), a separate program built on mautrix-linkedin
// that this connector runs and talks to over stdin and stdout. Signing in is your browser's session cookies,
// pasted in Settings and stored encrypted like any sign-in. On connecting, the conversations that changed
// since last time are caught up slowly, a page at a time with pauses, and then LinkedIn's real-time stream
// brings new messages as they arrive, so nothing is polled. Replies you queue in the app are sent; a
// conversation is marked read on LinkedIn only when you open it in the app; nothing else is ever sent.

const SYNC_SCOPE = "conversations"; // sync_state.sync_token: LinkedIn's token for "what changed since"
const CATCH_UP_CONVERSATIONS = 20; // the conversations caught up after connecting, newest first
const CATCH_UP_MESSAGES = 20; // the latest messages read from each
const CATCH_UP_PAUSE_MS = 3_000; // between conversations, so the catch-up is a trickle, not a burst
const TOUCH_MS = 60_000;

interface LinkedInCredentials {
  /** The Cookie header from linkedin.com, with at least li_at and JSESSIONID. */
  cookies: string;
  /** X-LI-Track and X-LI-Page-Instance from the same request, when a "Copy as cURL" had them. */
  xLiTrack?: string;
  pageInstance?: string;
}

export class LinkedInConnector {
  private helper: Helper | null = null;
  private me: LinkedInPerson | null = null;
  private ready = false;
  private stopped = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff(5_000, 10 * 60_000);
  private readonly pushback = new PushBack();
  /** Messages are stored one at a time, in the order they arrive. */
  private readonly queue = new SerialQueue();
  private readonly conversations = new Map<string, LinkedInConversation>();
  private end: ((outcome: Outcome) => void) | null = null;
  private lastTouch = 0;

  constructor(private readonly account: AccountRow, private readonly transport: () => Transport = () => spawnTransport()) {}

  get id() {
    return this.account.id;
  }

  start() {
    void this.run();
  }

  async stop() {
    this.stopped = true;
    this.sleeper.interrupt();
    this.end?.({ stop: true, detail: "" });
    await this.closeHelper();
  }

  private async run() {
    while (!this.stopped) {
      let outcome: Outcome;
      try {
        outcome = await this.session();
      } catch (err) {
        if (this.stopped) break;
        log.warn("linkedin session failed", { account: this.id, code: errorCode(err) });
        outcome = outcomeOf(err, this.pushback);
      }
      this.ready = false;
      await this.closeHelper();
      if (this.stopped) break;
      if (outcome.stop) {
        await setAccountStatus(this.id, "error", outcome.detail).catch(() => undefined);
        log.warn("linkedin stopped", { account: this.id });
        break;
      }
      const delay = outcome.waitMs ?? this.backoff.next();
      await setAccountStatus(this.id, "connecting", outcome.detail).catch(() => undefined);
      log.info("linkedin reconnecting", { account: this.id, inMs: delay });
      await this.sleeper.wait(delay);
    }
  }

  private async closeHelper() {
    const helper = this.helper;
    this.helper = null;
    await helper?.stop().catch(() => undefined);
  }

  /** One session, from starting the helper until the stream ends. Resolves with what to do next. */
  private async session(): Promise<Outcome> {
    if (!helperBuilt()) return { stop: true, detail: NOT_BUILT };
    const creds = await loadCredentials<LinkedInCredentials>(this.id);
    if (!creds.cookies?.trim()) return { stop: true, detail: NO_COOKIES };
    await setAccountStatus(this.id, "connecting", "Connecting to LinkedIn.");

    const ended = new Promise<Outcome>((resolve) => (this.end = resolve));
    // Events from a helper that has since been replaced (its exit, say) are not this session's.
    const helper: Helper = new Helper(this.transport(), (event) => {
      if (this.helper === helper) this.onEvent(event);
    });
    this.helper = helper;
    const state = await getSyncState(this.id, SYNC_SCOPE);
    const { me } = await helper.call("login", {
      cookies: creds.cookies,
      xLiTrack: creds.xLiTrack ?? "",
      pageInstance: creds.pageInstance ?? "",
      syncToken: state?.sync_token ?? "",
    });
    this.me = me;
    await this.saveIdentity(me);

    const first = !state?.sync_token;
    if (first) await setAccountStatus(this.id, "syncing", "Importing your recent LinkedIn conversations.");
    await this.catchUp(helper, me, !first);
    if (this.stopped) return { stop: true, detail: "" };

    await helper.call("connect", {});
    this.ready = true;
    this.pushback.ok();
    this.backoff.reset();
    await setAccountStatus(this.id, "connected");
    log.info("linkedin connected", { account: this.id });
    return ended;
  }

  /** Your profile URN becomes the account's address, sealed and indexed like any other. */
  private async saveIdentity(me: LinkedInPerson) {
    const keys = await keysFor(this.account.user_id);
    must(
      await db
        .from("accounts")
        .update({ label: "LinkedIn", address: await sealAddress(this.account.user_id, me.urn), address_index: await addressIndex(keys, me.urn) })
        .eq("id", this.id),
      "save linkedin account",
    );
  }

  /**
   * The conversations that changed while the worker was away (or, the first time, the latest ones), each
   * with its latest messages, one conversation at a time with a pause between. live is false the first time,
   * so an archived conversation stays archived and old ones do not jump to the top of the inbox.
   */
  private async catchUp(helper: Helper, me: LinkedInPerson, live: boolean) {
    const { conversations, syncToken } = await helper.call("changes", {});
    for (const c of conversations) this.conversations.set(c.urn, c);
    const wanted = conversations
      .filter((c) => !skipConversation(c, me.id))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, CATCH_UP_CONVERSATIONS);
    let stored = 0;
    for (const [i, conv] of wanted.entries()) {
      if (this.stopped) return;
      if (i > 0) await this.sleeper.wait(CATCH_UP_PAUSE_MS);
      const { messages } = await helper.call("messages", { conversation: conv.urn, count: CATCH_UP_MESSAGES });
      stored += await this.store(conv, messages, { live, unread: unreadUrns(conv, messages, me.id) });
    }
    await this.readElsewhere(conversations);
    if (syncToken) await saveSyncState(this.id, SYNC_SCOPE, { sync_token: syncToken });
    log.info("linkedin caught up", { account: this.id, conversations: wanted.length, stored, first: !live });
  }

  private sealer(): Sealer {
    const user = this.account.user_id;
    return {
      text: (field, value) => seal(user, field, value),
      address: (value) => sealAddress(user, value),
      addressIndex: async (value) => addressIndex(await keysFor(user), value),
      chatIndex: async (value) => chatIndex(await keysFor(user), value),
    };
  }

  /** Stores messages of one conversation, in order. Returns how many were new. */
  private async store(conv: LinkedInConversation, messages: LinkedInMessage[], opts: { live: boolean; unread: Set<string> }): Promise<number> {
    const me = this.me;
    if (!me) return 0;
    const sealer = this.sealer();
    let inserted = 0;
    for (const m of [...messages].sort((a, b) => a.deliveredAt - b.deliveredAt)) {
      try {
        const payload = await ingestPayload(m, conv, me.id, sealer, { live: opts.live, unread: opts.unread.has(m.urn) });
        if (!payload) continue;
        const stored = must(await db.rpc("ingest_linkedin", { p_account_id: this.id, p_msg: payload }), "ingest linkedin") as { result?: string };
        if (stored?.result === "inserted") inserted++;
      } catch (err) {
        log.warn("linkedin message failed", { account: this.id, code: errorCode(err) });
      }
    }
    return inserted;
  }

  /** Conversations read on LinkedIn (or its app) are read here too. Nothing is sent back. */
  private async readElsewhere(conversations: LinkedInConversation[]) {
    const read = conversations.filter((c) => c.read);
    if (read.length === 0) return;
    const keys = await keysFor(this.account.user_id);
    const indexes = await Promise.all(read.map((c) => chatIndex(keys, c.urn)));
    must(await db.rpc("whatsapp_mark_read", { p_account_id: this.id, p_chat_jids: [], p_chat_indexes: indexes }), "mark linkedin read");
  }

  private onEvent(event: HelperEvent) {
    switch (event.event) {
      case "message":
        this.queue.background(() => this.onMessage(event.message), (err) => log.warn("linkedin live message failed", { account: this.id, code: errorCode(err) }));
        return;
      case "conversation":
        this.conversations.set(event.conversation.urn, event.conversation);
        this.queue.background(() => this.readElsewhere([event.conversation]), () => undefined);
        return;
      case "connected":
      case "heartbeat":
        if (Date.now() - this.lastTouch > TOUCH_MS) {
          this.lastTouch = Date.now();
          void touchAccount(this.id);
        }
        return;
      case "bad_credentials":
        this.end?.({ stop: true, detail: SIGNED_OUT });
        return;
      case "failed":
        this.end?.({ stop: false, detail: RECONNECTING, waitMs: null });
        return;
    }
  }

  /** A message from the real-time stream: from someone else it arrives unread; your own (sent elsewhere) is read. */
  private async onMessage(m: LinkedInMessage) {
    const me = this.me;
    if (!me) return;
    let conv = this.conversations.get(m.conversationUrn);
    if (!conv && this.helper && this.ready) {
      // A conversation started since connecting: ask what changed, once, to learn who is in it.
      const changes = await this.helper.call("changes", {}).catch(() => null);
      for (const c of changes?.conversations ?? []) this.conversations.set(c.urn, c);
      if (changes?.syncToken) await saveSyncState(this.id, SYNC_SCOPE, { sync_token: changes.syncToken });
      conv = this.conversations.get(m.conversationUrn);
    }
    const target = conv ?? stubConversation(m, me);
    if (skipConversation(target, me.id)) return;
    const inbound = m.sender?.id !== me.id;
    if (await this.store(target, [m], { live: true, unread: inbound ? new Set([m.urn]) : new Set() })) {
      log.info("linkedin message stored", { account: this.id });
    }
  }

  // ---------------------------------------------------------------------------
  // Sending and read receipts
  // ---------------------------------------------------------------------------

  /**
   * Sends one reply you queued in the app. Claimed first, so it can never go out twice; while not connected
   * it waits in the queue. Files are not sent to LinkedIn yet.
   */
  async send(queuedRow: OutboxRow) {
    const helper = this.helper;
    if (!helper || !this.ready) return;
    const row = await claimReady(queuedRow);
    if (!row) return;
    if (row.attachment_count > 0) {
      await markFailed(row.id, "Files cannot be sent to LinkedIn from Konva yet. Send the text on its own.");
      return;
    }
    if (!row.thread_id) {
      await markFailed(row.id, "New LinkedIn conversations cannot be started from Konva yet. Reply to one instead.");
      return;
    }
    const thread = must(await db.from("threads").select("account_id, user_id, channel, provider_thread_id").eq("id", row.thread_id).maybeSingle(), "load linkedin thread");
    await openAddresses(this.account.user_id, thread);
    if (!thread || thread.account_id !== this.id || thread.user_id !== row.user_id || thread.channel !== "linkedin") {
      await markFailed(row.id, "This message belongs to another account.");
      return;
    }
    const text = ((await open(row.user_id, FIELD.body, row.body)) ?? "").trim();
    if (!text) {
      await markFailed(row.id, "There is nothing to send.");
      return;
    }
    let sent: LinkedInMessage;
    try {
      ({ message: sent } = await helper.call("send", { conversation: thread.provider_thread_id, text, token: row.id }));
    } catch (err) {
      log.warn("linkedin reply failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(
        row.id,
        surelyNotSent(err) ? "LinkedIn did not take the message, so it was not sent. Try again later." : "The message may not have been sent. Check LinkedIn before sending again.",
      ).catch(() => undefined);
      if (err instanceof HelperError && err.kind !== "bad_request" && surelyNotSent(err)) this.end?.(outcomeOf(err, this.pushback));
      return;
    }
    if (!(await settleSent(row.id, sent.urn || row.id))) log.warn("linkedin reply sent but not recorded", { account: this.id, outbox: row.id });
    else log.info("linkedin reply sent", { account: this.id, outbox: row.id });
    // Stored at once, so it shows in the conversation; the stream's copy of it then finds it there.
    const me = this.me;
    if (me && sent.urn) {
      const mine = { ...sent, sender: sent.sender ?? me, conversationUrn: sent.conversationUrn || thread.provider_thread_id };
      const conv = this.conversations.get(mine.conversationUrn) ?? stubConversation(mine, me);
      await this.queue.run(async () => void (await this.store(conv, [mine], { live: true, unread: new Set() }))).catch(() => undefined);
    }
  }

  /**
   * A 'read' action means you opened the conversation in the app: only then is LinkedIn told it was read,
   * and only if it had unread messages. Reactions are not sent; archive, unread and the rest stay in the app.
   */
  async applyAction(row: Tables<"mail_actions">) {
    const helper = this.helper;
    if (!helper || !this.ready) return; // not connected: the next poll retries it
    if (row.action === "react") {
      await finishAction(row.id, "Reactions are not sent to LinkedIn.");
      return;
    }
    if (row.action !== "read") {
      await finishAction(row.id);
      return;
    }
    try {
      const pending = must(
        await db
          .from("messages")
          .select("id")
          .eq("thread_id", row.thread_id)
          .eq("account_id", this.id)
          .eq("direction", "inbound")
          .eq("provider_meta->>receipt", "pending")
          .limit(500),
        "load unread linkedin messages",
      );
      if (pending.length > 0) {
        const thread = must(await db.from("threads").select("account_id, provider_thread_id").eq("id", row.thread_id).maybeSingle(), "load linkedin thread");
        await openAddresses(this.account.user_id, thread);
        if (!thread || thread.account_id !== this.id) throw Object.assign(new Error("no thread"), { code: "NO_THREAD" });
        await helper.call("read", { conversation: thread.provider_thread_id });
        must(await db.rpc("whatsapp_set_receipt", { p_account_id: this.id, p_message_ids: pending.map((m) => m.id), p_state: "sent" }), "record receipts");
        log.info("linkedin read sent", { account: this.id, messages: pending.length });
      }
      await finishAction(row.id);
    } catch (err) {
      log.warn("linkedin action failed", { account: this.id, action: row.action, code: errorCode(err) });
      await finishAction(row.id, "Could not tell LinkedIn you read this conversation.");
    }
  }
}
