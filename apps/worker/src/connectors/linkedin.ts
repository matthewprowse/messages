// LinkedIn messages, through the LinkedIn helper (apps/linkedin), a separate program built on mautrix-linkedin
// that this connector runs and talks to over stdin and stdout. You sign in with your LinkedIn email and password,
// typed in Konva's own form: the app stores them encrypted, this connector signs in with them through the helper,
// hands any code or approval LinkedIn asks for back and forth with the page (linkedin/relay.ts), and then keeps
// only the session, cookies and the browser headers it was created with, encrypted. The password is dropped as
// soon as the sign-in ends, either way. (Cookies pasted in Settings still work: they are a session already.) On connecting, the conversations that changed
// since last time are caught up slowly, a page at a time with pauses, and then LinkedIn's real-time stream
// brings new messages as they arrive, so nothing is polled. Replies you queue in the app are sent, and so is the first message of a new conversation; a
// conversation is marked read on LinkedIn only when you open it in the app; nothing else is ever sent. Photos,
// videos and documents go with a reply (each as a message of its own, the text with the first). The profile
// pictures of the people you talk to become their contact photos where they have none (linkedin/avatars.ts).

import type { Tables } from "@messages/db";
import { addressIndex, chatIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { Backoff, SerialQueue, Sleeper } from "../backoff";
import { db, getSyncState, loadCredentials, must, retryWrite, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { errorCode, log } from "../log";
import { finishAction, NotReady } from "../send/actions";
import { claimReady, linkThread, markFailed, settleSent, type OutboxRow } from "../send/outbox";
import { loadAttachmentFiles } from "../send/outbox-attachments";
import { saveContactPhoto } from "../photos/store";
import { credentialSealer, keysFor, open, openAddresses, seal, sealAddress } from "../vault";
import { Helper, HelperError, helperBuilt, spawnTransport, type BrowserHeaders, type Commands, type HelperEvent, type LinkedInConversation, type LinkedInMessage, type LinkedInPerson, type SignInResult, type Transport } from "../linkedin/helper";
import { NO_FILES, sendTimeoutMs, stageFiles, type StagedFiles } from "../linkedin/files";
import { RecentTries, fetchPictureBytes, photoDue, withPictures } from "../linkedin/avatars";
import { catchUpTargets, mayAdvanceToken } from "../linkedin/catch-up";
import { ingestPayload, others, seenByOther, skipConversation, stubConversation, unreadUrns, type Sealer } from "../linkedin/mapping";
import { CODE_TIMED_OUT, NO_COOKIES, NOT_BUILT, PushBack, RECONNECTING, SIGNED_OUT, SIGN_IN_EXPIRED, START_NO_PERSON, checkpointDetail, endsSession, outcomeOf, recipientOf, sendFailure, signInFailure, startFailure, surelyNotSent, type Outcome } from "../linkedin/policy";
import { waitForReply, type Reply, type SignInStep } from "../linkedin/relay";
import { readRelay, writeRelay } from "../linkedin/relay-db";

const SYNC_SCOPE = "conversations"; // sync_state.sync_token: LinkedIn's token for "what changed since"
const CATCH_UP_CONVERSATIONS = 20; // the conversations imported on the first run, newest first (later runs read every changed one)
const CATCH_UP_MESSAGES = 20; // the latest messages read from each
const CATCH_UP_PAUSE_MS = 3_000; // between conversations, so the catch-up is a trickle, not a burst
const TOUCH_MS = 60_000;
const SIGN_IN_TTL_MS = 15 * 60_000; // a password left unused for longer than this is thrown away, never tried
const REPLY_POLL_MS = 2_000; // how often the page's answer to a code or approval step is looked for
const CODE_WAIT_MS = 10 * 60_000; // how long a code is waited for
const APP_WAIT_MS = 12 * 60_000; // how long an approval in the LinkedIn app is waited for
const PHOTO_PAUSE_MS = 1_500; // between profile pictures, so they are a trickle too
const HANDOFF_MS = 45_000; // after signing in, the worker restarts this connector with the new session; this is only the fallback

interface LinkedInCredentials {
  /** The session, from a password sign-in or pasted cookies: a Cookie header with at least li_at and JSESSIONID. */
  cookies?: string;
  /** The browser headers (User-Agent and its companions) a password sign-in created the session with. */
  headers?: BrowserHeaders;
  /** X-LI-Track and X-LI-Page-Instance from the same request, when a "Copy as cURL" had them. */
  xLiTrack?: string;
  pageInstance?: string;
  /** An http, https or socks5 proxy every LinkedIn request of this account goes through, when it has one. */
  proxy?: string;
  /** A sign-in waiting to happen, saved by the app: the email and password, and when (Unix ms). Dropped once used. */
  email?: string;
  password?: string;
  requestedAt?: number;
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
  /** Profile pictures are fetched one at a time, apart from the messages, so a slow picture never holds one up. */
  private readonly photoQueue = new SerialQueue();
  private readonly photoTries = new RecentTries();

  constructor(private readonly account: AccountRow, private readonly transport: (proxy?: string) => Transport = (proxy) => spawnTransport(undefined, proxy)) {}

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
    const creds = await loadCredentials<LinkedInCredentials>(this.id);
    if (!helperBuilt()) {
      // For whoever runs the worker; people are only told it is not available.
      log.error("linkedin helper is not built: run pnpm linkedin:build in the project folder", { account: this.id });
      if (creds.password) await this.dropPassword(creds);
      return { stop: true, detail: NOT_BUILT };
    }
    if (creds.password) return this.signIn(creds);
    // A sign-in that ended left no session; what it said (still on the account) is what to keep saying.
    if (!creds.cookies?.trim()) return { stop: true, detail: this.account.status === "error" && this.account.status_detail ? this.account.status_detail : NO_COOKIES };
    await setAccountStatus(this.id, "connecting", "Connecting to LinkedIn.");

    const ended = new Promise<Outcome>((resolve) => (this.end = resolve));
    // Events from a helper that has since been replaced (its exit, say) are not this session's.
    const helper: Helper = new Helper(this.transport(creds.proxy), (event) => {
      if (this.helper === helper) this.onEvent(event);
    });
    this.helper = helper;
    const state = await getSyncState(this.id, SYNC_SCOPE);
    const { me } = await helper.call("login", {
      cookies: creds.cookies,
      // The headers the session was created with, so LinkedIn sees the same browser and does not end it.
      headers: creds.headers,
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

  // ---------------------------------------------------------------------------
  // Signing in with a password
  // ---------------------------------------------------------------------------

  /**
   * The sign-in the app saved: email and password through the helper, then whatever LinkedIn asks for, a
   * code or an approval in its app, shown on the page through the relay. When it is done the session replaces
   * the password and the connector restarts on it; when it fails the password is dropped and the account
   * says why.
   */
  private async signIn(creds: LinkedInCredentials): Promise<Outcome> {
    if (!(Date.now() - (creds.requestedAt ?? 0) < SIGN_IN_TTL_MS)) return this.endSignIn(creds, SIGN_IN_EXPIRED);
    await setAccountStatus(this.id, "connecting", "Signing in to LinkedIn.");
    await writeRelay(this.id, null);
    const helper = new Helper(this.transport(creds.proxy), () => undefined);
    this.helper = helper;
    try {
      let result: SignInResult = await helper.call("signin", { email: creds.email ?? "", password: creds.password ?? "", proxy: creds.proxy });
      let attempts = 0;
      for (;;) {
        if (this.stopped) return { stop: true, detail: "" };
        if (result.state === "done") return await this.finishSignIn(creds, result);
        const step: SignInStep =
          result.state === "code"
            ? { kind: "code", method: result.method, canTryAnotherWay: false, attempts: ++attempts, rejected: result.rejected === true }
            : { kind: "app", method: null, canTryAnotherWay: result.canTryAnotherWay, attempts: ++attempts, rejected: false };
        await writeRelay(this.id, { step });
        await setAccountStatus(this.id, "connecting", checkpointDetail(step, step.rejected));
        if (step.kind === "code") {
          const reply = await this.reply("code", CODE_WAIT_MS);
          if (this.stopped) return { stop: true, detail: "" };
          if (!reply || !("code" in reply)) return await this.endSignIn(creds, CODE_TIMED_OUT);
          result = await helper.call("code", { code: reply.code });
        } else {
          result = await this.approval(helper, step.canTryAnotherWay);
        }
      }
    } catch (err) {
      if (this.stopped) return { stop: true, detail: "" };
      log.warn("linkedin sign-in failed", { account: this.id, code: errorCode(err), stage: err instanceof HelperError ? err.stage : undefined });
      return this.endSignIn(creds, signInFailure(err));
    }
  }

  /** Waits for the person to type the code, or to choose Try Another Way. Null when the time is up. */
  private reply(want: "code" | "anotherWay", timeoutMs: number, extraStop: () => boolean = () => false): Promise<Reply | null> {
    return waitForReply(() => readRelay(this.id), (ms) => this.sleeper.wait(ms), { want, timeoutMs, pollMs: REPLY_POLL_MS, stopped: () => this.stopped || extraStop() });
  }

  /** The wait for the sign-in to be approved in the LinkedIn app, which the person can swap for a code. */
  private async approval(helper: Helper, canTryAnotherWay: boolean): Promise<SignInResult> {
    const waiting = helper.call("app", {}, APP_WAIT_MS).catch((err: unknown) => {
      throw err instanceof HelperError && err.kind === "timeout" ? new HelperError("rejected", undefined, "app_approval_expired") : err;
    });
    if (!canTryAnotherWay) return waiting;
    waiting.catch(() => undefined); // when Try Another Way ends the wait, its answer is not needed
    let finished = false;
    try {
      const first = await Promise.race([
        waiting.then((result) => ({ result })),
        this.reply("anotherWay", APP_WAIT_MS, () => finished).then((reply) => ({ reply })),
      ]);
      if ("result" in first) return first.result;
      if (first.reply) return await helper.call("another_way", {});
      throw new HelperError("rejected", undefined, "app_approval_expired");
    } finally {
      finished = true;
    }
  }

  /** The session replaces the password in one write, and the account goes on to connect with it. */
  private async finishSignIn(creds: LinkedInCredentials, result: Extract<SignInResult, { state: "done" }>): Promise<Outcome> {
    const session: LinkedInCredentials = { cookies: result.cookies, headers: result.headers, ...(creds.proxy ? { proxy: creds.proxy } : {}) };
    const ciphertext = await (await credentialSealer(this.id, this.account.user_id)).sealJson(session);
    must(
      await db.from("account_credentials").update({ ciphertext, refreshed: null }).eq("account_id", this.id),
      "save linkedin session",
    );
    await setAccountStatus(this.id, "connecting", "Connecting to LinkedIn.");
    log.info("linkedin signed in", { account: this.id });
    // The new credentials restart this connector within seconds; this only waits for that.
    return { stop: false, detail: "Connecting to LinkedIn.", waitMs: HANDOFF_MS };
  }

  /** A sign-in that ended without a session: the account says why, and the password is gone. */
  private async endSignIn(creds: LinkedInCredentials, detail: string): Promise<Outcome> {
    // Said first, so the restart that dropping the password causes finds it on the account.
    await setAccountStatus(this.id, "error", detail).catch(() => undefined);
    await this.dropPassword(creds);
    return { stop: true, detail };
  }

  /** Overwrites the saved sign-in with nothing but its proxy. Never throws: a failed write is only logged. */
  private async dropPassword(creds: LinkedInCredentials) {
    const kept: LinkedInCredentials = creds.proxy ? { proxy: creds.proxy } : {};
    const ciphertext = await (await credentialSealer(this.id, this.account.user_id)).sealJson(kept);
    const ok = await retryWrite(() => db.from("account_credentials").update({ ciphertext, refreshed: null }).eq("account_id", this.id));
    if (!ok) log.error("linkedin sign-in could not be cleared", { account: this.id });
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
    const wanted = catchUpTargets(conversations, me.id, live, CATCH_UP_CONVERSATIONS);
    let stored = 0;
    let failed = 0; // the token moves past every conversation, so any that did not store must be read again
    for (const [i, conv] of wanted.entries()) {
      if (this.stopped) return;
      if (i > 0) await this.sleeper.wait(CATCH_UP_PAUSE_MS);
      const { messages } = await helper.call("messages", { conversation: conv.urn, count: CATCH_UP_MESSAGES });
      stored += await this.store(conv, messages, { live, unread: unreadUrns(conv, messages, me.id), onFail: () => failed++ });
    }
    await this.readElsewhere(conversations);
    if (syncToken && mayAdvanceToken(failed)) await saveSyncState(this.id, SYNC_SCOPE, { sync_token: syncToken });
    log.info("linkedin caught up", { account: this.id, conversations: wanted.length, stored, failed, first: !live });
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
  private async store(conv: LinkedInConversation, messages: LinkedInMessage[], opts: { live: boolean; unread: Set<string>; onFail?: () => void }): Promise<number> {
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
        opts.onFail?.();
      }
    }
    this.queuePhotos(others(conv, me.id));
    return inserted;
  }

  /**
   * Gives the people of a conversation their LinkedIn profile picture as the contact's photo, where the
   * contact has none (or a LinkedIn one a week old). Runs in the background and never throws: a failure is only
   * logged, by its code, and the picture's address is never logged.
   */
  private queuePhotos(people: LinkedInPerson[]) {
    const helper = this.helper;
    const me = this.me;
    if (!helper || !me) return;
    const wanted = withPictures(people, me.id).filter((p) => this.photoTries.try(p.urn));
    if (wanted.length === 0) return;
    this.photoQueue.background(
      () => this.savePhotos(helper, wanted),
      (err) => log.warn("linkedin photos failed", { account: this.id, code: errorCode(err) }),
    );
  }

  private async savePhotos(helper: Helper, people: LinkedInPerson[]) {
    const user = this.account.user_id;
    const keys = await keysFor(user);
    const byIndex = new Map<string, LinkedInPerson>();
    for (const p of people) byIndex.set(await addressIndex(keys, p.urn), p);
    const identities = must(
      await db.from("contact_identities").select("contact_id, value_index").eq("user_id", user).eq("kind", "linkedin").in("value_index", [...byIndex.keys()]),
      "load linkedin contacts",
    );
    if (identities.length === 0) return;
    const contacts = must(
      await db.from("contacts").select("id, avatar_path, avatar_source, avatar_updated_at").in("id", [...new Set(identities.map((i) => i.contact_id))]),
      "load linkedin contact photos",
    );
    const current = new Map(contacts.map((c) => [c.id, c]));
    const done = new Set<string>();
    let saved = 0;
    for (const identity of identities) {
      const person = byIndex.get(identity.value_index ?? "");
      const contact = current.get(identity.contact_id);
      if (this.stopped || this.helper !== helper || !person?.picture || done.has(identity.contact_id) || !photoDue(contact)) continue;
      done.add(identity.contact_id);
      try {
        const bytes = await fetchPictureBytes(helper, person.picture);
        if (bytes && (await saveContactPhoto(user, identity.contact_id, "linkedin", bytes, contact))) saved++;
      } catch (err) {
        // Nothing is saved, so the contact is due again once the wait for this person is over.
        log.warn("linkedin photo failed", { account: this.id, code: errorCode(err) });
      }
      await this.sleeper.wait(PHOTO_PAUSE_MS);
    }
    if (saved > 0) log.info("linkedin photos saved", { account: this.id, saved });
  }

  /** Conversations read on LinkedIn (or its app) are read here too. Nothing is sent back. */
  private async readElsewhere(conversations: LinkedInConversation[]) {
    const read = conversations.filter((c) => c.read);
    if (read.length === 0) return;
    const keys = await keysFor(this.account.user_id);
    const indexes = await Promise.all(read.map((c) => chatIndex(keys, c.urn)));
    must(await db.rpc("whatsapp_mark_read", { p_account_id: this.id, p_chat_jids: [], p_chat_indexes: indexes }), "mark linkedin read");
  }

  /** Your messages in a conversation that the other person has seen are shown as seen. Nothing is sent back. */
  private async markSeen(conversationUrn: string, at: number) {
    const keys = await keysFor(this.account.user_id);
    const sealed = await sealAddress(this.account.user_id, conversationUrn);
    must(
      await db.rpc("mark_seen_up_to", {
        p_account_id: this.id,
        p_thread_provider_id: sealed,
        p_seen_at: new Date(at).toISOString(),
        p_thread_index: await chatIndex(keys, conversationUrn),
      }),
      "mark linkedin seen",
    );
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
      case "seen": {
        const at = this.me ? seenByOther(this.conversations.get(event.conversationUrn), event.by, event.at, this.me.id) : null;
        if (at !== null) this.queue.background(() => this.markSeen(event.conversationUrn, at), (err) => log.warn("linkedin seen failed", { account: this.id, code: errorCode(err) }));
        return;
      }
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
   * Sends one reply you queued in the app, or the first message of a new conversation. Claimed first, so it can never go out twice; while not connected
   * it waits in the queue. Photos, videos and documents go with it, one message each.
   */
  async send(queuedRow: OutboxRow) {
    const helper = this.helper;
    if (!helper || !this.ready) return;
    const row = await claimReady(queuedRow);
    if (!row) return;
    if (!row.thread_id) {
      await this.startConversation(helper, row);
      return;
    }
    const thread = must(await db.from("threads").select("account_id, user_id, channel, provider_thread_id").eq("id", row.thread_id).maybeSingle(), "load linkedin thread");
    await openAddresses(this.account.user_id, thread);
    if (!thread || thread.account_id !== this.id || thread.user_id !== row.user_id || thread.channel !== "linkedin") {
      await markFailed(row.id, "This message belongs to another account.");
      return;
    }
    const text = ((await open(row.user_id, FIELD.body, row.body)) ?? "").trim();
    if (!text && !(row.attachment_count > 0)) {
      await markFailed(row.id, "There is nothing to send.");
      return;
    }
    const staged = await this.stageFiles(row);
    if (!staged) return;
    let result: Commands["send"]["result"];
    try {
      const attachments = staged.files.length > 0 ? { attachments: staged.files } : {};
      result = await helper.call("send", { conversation: thread.provider_thread_id, text, token: row.id, ...attachments }, sendTimeoutMs(staged.files.length));
    } catch (err) {
      log.warn("linkedin reply failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(row.id, sendFailure(err)).catch(() => undefined);
      if (err instanceof HelperError && err.kind !== "bad_request" && surelyNotSent(err)) this.end?.(outcomeOf(err, this.pushback));
      return;
    } finally {
      await staged.cleanup();
    }
    const messages = result.messages?.length ? result.messages : [result.message];
    const sent = messages[0];
    if (!(await settleSent(row.id, sent.urn || row.id))) log.warn("linkedin reply sent but not recorded", { account: this.id, outbox: row.id });
    else log.info("linkedin reply sent", { account: this.id, outbox: row.id, files: staged.files.length });
    // Stored at once, so it shows in the conversation; the stream's copy of it then finds it there.
    const me = this.me;
    if (me) {
      const mine = messages.filter((m) => m.urn).map((m) => ({ ...m, sender: m.sender ?? me, conversationUrn: m.conversationUrn || thread.provider_thread_id }));
      if (mine.length > 0) {
        const conv = this.conversations.get(mine[0].conversationUrn) ?? stubConversation(mine[0], me);
        await this.queue.run(async () => void (await this.store(conv, mine, { live: true, unread: new Set() }))).catch(() => undefined);
      }
    }
  }

  /**
   * The files of a claimed row, downloaded and written to a private temp folder for the helper (always removed
   * again by the caller). A row without files gets an empty set. Null when the row could not be sent: it has
   * been failed, with what to tell the person.
   */
  private async stageFiles(row: OutboxRow): Promise<StagedFiles | null> {
    if (!(row.attachment_count > 0)) return NO_FILES;
    try {
      const files = await loadAttachmentFiles(row, "linkedin");
      if ("error" in files) {
        await markFailed(row.id, files.error);
        return null;
      }
      return await stageFiles(files);
    } catch (err) {
      log.warn("linkedin attachments failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(row.id, "The attachments could not be read. Try again.").catch(() => undefined);
      return null;
    }
  }

  /**
   * Sends the first message of a new conversation, queued without a thread: to one member, named by a profile
   * link or the URN of someone you already message. The helper finds them, LinkedIn creates the conversation,
   * and the message is stored like a reply is, which creates the thread; the row is then linked to it so the
   * app can open it. LinkedIn may refuse a person you are not connected to; the row then says so.
   */
  private async startConversation(helper: Helper, row: OutboxRow) {
    const me = this.me;
    if (row.account_id !== this.id || row.user_id !== this.account.user_id || !me) {
      await markFailed(row.id, "This message belongs to another account.");
      return;
    }
    const profile = recipientOf(row.to_addresses);
    if (!profile) {
      await markFailed(row.id, START_NO_PERSON);
      return;
    }
    const text = ((await open(row.user_id, FIELD.body, row.body)) ?? "").trim();
    if (!text && !(row.attachment_count > 0)) {
      await markFailed(row.id, "There is nothing to send.");
      return;
    }
    const staged = await this.stageFiles(row);
    if (!staged) return;
    let started: Commands["start"]["result"];
    try {
      const attachments = staged.files.length > 0 ? { attachments: staged.files } : {};
      started = await helper.call("start", { profile, text, token: row.id, ...attachments }, sendTimeoutMs(staged.files.length));
    } catch (err) {
      log.warn("linkedin new conversation failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(row.id, startFailure(err, staged.files.length > 0)).catch(() => undefined);
      if (endsSession(err)) this.end?.(outcomeOf(err, this.pushback));
      return;
    } finally {
      await staged.cleanup();
    }
    const sent = started.message;
    if (!(await settleSent(row.id, sent.urn || row.id))) log.warn("linkedin new conversation sent but not recorded", { account: this.id, outbox: row.id });
    else log.info("linkedin new conversation sent", { account: this.id, outbox: row.id });
    const conv = started.conversation;
    this.conversations.set(conv.urn, conv);
    const mine = { ...sent, sender: sent.sender ?? me, conversationUrn: sent.conversationUrn || conv.urn };
    // A first message with several files has the others in the conversation, sent after it.
    const followUps = (conv.messages ?? []).filter((m) => m.urn && m.urn !== sent.urn).map((m) => ({ ...m, sender: m.sender ?? me, conversationUrn: m.conversationUrn || conv.urn }));
    await this.queue.run(async () => void (await this.store(conv, [mine, ...followUps], { live: true, unread: new Set() }))).catch(() => undefined);
    await this.linkNewConversation(row.id, mine.urn);
  }

  /** Points a sent new conversation at its thread, once stored, so the app can open it. */
  private async linkNewConversation(outboxId: string, providerMessageId: string) {
    try {
      const stored = must(
        await db.from("messages").select("thread_id").eq("account_id", this.id).eq("provider_message_id", providerMessageId).maybeSingle(),
        "find new linkedin conversation",
      );
      if (stored) await linkThread(outboxId, stored.thread_id);
      else log.warn("linkedin new conversation not stored yet", { account: this.id, outbox: outboxId });
    } catch (err) {
      log.warn("linkedin link new conversation failed", { account: this.id, outbox: outboxId, code: errorCode(err) });
    }
  }

  /**
   * A 'read' action means you opened the conversation in the app: only then is LinkedIn told it was read,
   * and only if it had unread messages. Reactions are not sent; archive, unread and the rest stay in the app.
   */
  async applyAction(row: Tables<"mail_actions">) {
    const helper = this.helper;
    if (!helper || !this.ready) throw new NotReady(); // not connected: back to queued, the next poll retries it
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
