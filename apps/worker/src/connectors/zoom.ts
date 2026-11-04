// Zoom: meetings with their transcripts from your cloud recordings (zoom/recordings.ts), and Team Chat as
// conversations (zoom/chat.ts), both polled since there is no public endpoint for Zoom's webhooks. Replies
// queued in the outbox go out with the chat messages API. Each part runs when its scopes were granted.

import type { Json, Tables, TablesInsert, TablesUpdate } from "@messages/db";
import { addressIndex, chatIndex, groupNameIndex } from "@messages/crypto/addresses";
import { Backoff, Sleeper } from "../backoff";
import { db, getSyncState, must, saveSyncState, setAccountStatus, type AccountRow } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { finishAction } from "../send/actions";
import { claimReady, markFailed, outboxBody, settleSent, type OutboxRow } from "../send/outbox";
import { ATTACHMENTS_BUCKET, uploadObject, WRITE_ONCE_CACHE_S } from "../storage";
import { chunks } from "../util";
import { keysFor, openAddresses, seal, sealAddress, sealBytes } from "../vault";
import { rateLimited, signInRevoked, ZoomApiError, type ZoomClient } from "../zoom/client";
import { ChatSync, chatPayload, sendBody, type ChatRef, type ChatSealer, type ZoomChatStored } from "../zoom/chat";
import { CHAT_NEEDS, CHAT_SEND_SCOPE, MEETING_SCOPE, MEETINGS_NEEDS, PARTICIPANTS_SCOPE, USER_SCOPE } from "../zoom/oauth";
import { RecordingSync, type MeetingStore, type StoredMeeting } from "../zoom/recordings";
import { openZoomClient, zoomFatalDetail } from "../zoom/session";

const CHAT_POLL_MS = 60_000;
const RECORDINGS_POLL_MS = 10 * 60_000;
/** Each recordings poll looks this far back: a transcript can take a while, and waiting meetings are looked at again. */
const RECORDINGS_LOOKBACK_DAYS = 7;
/** The longest a rate limit holds the connector back. Zoom's daily limits name the next day. */
const MAX_LIMIT_WAIT_MS = 6 * 60 * 60_000;
/** Zoom's longest chat message. */
const MAX_MESSAGE_CHARS = 4096;

const CHAT_STATE = "zoom_chat";
const RECORDINGS_STATE = "zoom_recordings";

export class ZoomConnector {
  private stopped = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  /** The signed-in client while a session is running; queued replies wait until there is one. */
  private client: ZoomClient | null = null;
  private selfEmail = "";
  private canSend = false;
  private lastRecordings = 0;

  constructor(private readonly account: AccountRow) {}

  get id() {
    return this.account.id;
  }

  start() {
    void this.run();
  }

  async stop() {
    this.stopped = true;
    this.sleeper.interrupt();
  }

  private async run() {
    while (!this.stopped) {
      let wait: number | null = null;
      try {
        await this.session();
      } catch (err) {
        if (this.stopped) break;
        const fatal = zoomFatalDetail(err);
        if (fatal) {
          if (signInRevoked(err)) log.error("zoom sign-in revoked", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", fatal).catch(() => undefined);
          return;
        }
        if (rateLimited(err)) {
          wait = Math.min(MAX_LIMIT_WAIT_MS, err.retryAfterMs ?? this.backoff.next());
          log.warn("zoom rate limited", { account: this.id, waitMs: wait });
          await setAccountStatus(this.id, "connecting", "Zoom asked to slow down. Syncing again shortly.").catch(() => undefined);
        } else {
          log.warn("zoom sync failed", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
        }
      }
      this.client = null;
      if (this.stopped) break;
      await this.sleeper.wait(wait ?? this.backoff.next());
    }
  }

  private async session() {
    await setAccountStatus(this.id, "connecting");
    const { client, creds } = await openZoomClient(this.id);
    const has = (scope: string) => creds.scopes.includes(scope);
    const meetings = MEETINGS_NEEDS.every(has);
    const chat = CHAT_NEEDS.every(has);
    if (!meetings && !chat) throw Object.assign(new Error("scope not granted"), { code: "NOT_GRANTED" });

    let selfId = creds.userId;
    this.selfEmail = creds.email;
    if (has(USER_SCOPE)) {
      const me = await client.request<{ id?: string; email?: string }>("/users/me");
      selfId = me.id || selfId;
      this.selfEmail = me.email?.toLowerCase() || this.selfEmail;
    }
    this.client = client;
    this.canSend = chat && has(CHAT_SEND_SCOPE);

    const userId = this.account.user_id;
    const recordings = meetings
      ? new RecordingSync(client, meetingStore(this.id), { seal: (f, v) => seal(userId, f, v), sealAddress: (v) => sealAddress(userId, v), sealBytes: (f, b, where) => sealBytes(userId, f, b, where) }, {
          userId,
          accountId: this.id,
          selfId,
          selfEmail: this.selfEmail,
          canReadMeeting: has(MEETING_SCOPE),
          canReadParticipants: has(PARTICIPANTS_SCOPE),
        })
      : null;
    const chats = chat ? new ChatSync(client, { ingest: (payload) => this.ingest(payload) }, this.sealer(), { selfEmail: this.selfEmail, accountId: this.id }) : null;

    await setAccountStatus(this.id, "syncing");
    while (!this.stopped) {
      if (chats) await this.syncChats(chats);
      if (recordings && Date.now() - this.lastRecordings >= RECORDINGS_POLL_MS) {
        await this.syncRecordings(recordings);
        this.lastRecordings = Date.now();
      }
      this.backoff.reset();
      await setAccountStatus(this.id, "connected");
      await this.sleeper.wait(CHAT_POLL_MS);
    }
  }

  /** New chat messages since the last poll. The first poll imports the last INITIAL_SYNC_DAYS, as read. */
  private async syncChats(chats: ChatSync) {
    const state = await getSyncState(this.id, CHAT_STATE);
    const until = new Date();
    const since = state?.sync_token ? new Date(state.sync_token) : new Date(until.getTime() - env.initialSyncDays * 86_400_000);
    const inserted = await chats.sync(since, until, !!state?.sync_token);
    await saveSyncState(this.id, CHAT_STATE, { sync_token: until.toISOString() });
    if (inserted > 0) log.info("zoom chat messages stored", { account: this.id, inserted });
  }

  /** Recorded meetings: the last INITIAL_SYNC_DAYS the first time, then the last week each time. */
  private async syncRecordings(recordings: RecordingSync) {
    const state = await getSyncState(this.id, RECORDINGS_STATE);
    const days = state?.sync_token ? RECORDINGS_LOOKBACK_DAYS : env.initialSyncDays;
    const stored = await recordings.sync(new Date(Date.now() - days * 86_400_000));
    if (!state?.sync_token) await saveSyncState(this.id, RECORDINGS_STATE, { sync_token: new Date().toISOString() });
    if (stored > 0) log.info("zoom meetings stored", { account: this.id, stored });
  }

  private sealer(): ChatSealer {
    const userId = this.account.user_id;
    return {
      seal: (field, value) => seal(userId, field, value),
      sealAddress: (value) => sealAddress(userId, value),
      addressIndex: async (value) => addressIndex(await keysFor(userId), value),
      chatIndex: async (value) => chatIndex(await keysFor(userId), value),
      groupIndex: async (value) => groupNameIndex(await keysFor(userId), value),
    };
  }

  private async ingest(payload: Json): Promise<ZoomChatStored> {
    return must(await db.rpc("ingest_zoom_chat", { p_account_id: this.id, p_msg: payload }), "ingest zoom chat") as ZoomChatStored;
  }

  /**
   * Sends a queued reply into its Zoom chat, as a thread reply when it answers a message. The row is claimed
   * first, so it can never go out twice. Files and new chats are not supported yet.
   */
  async send(queuedRow: OutboxRow) {
    const client = this.client;
    if (!client) return; // starting up: picked up again on the next pass
    const row = await claimReady(queuedRow);
    if (!row) return;
    if (!this.canSend) {
      await markFailed(row.id, "Zoom was connected without permission to send. Reconnect Zoom in Settings, then send again.");
      return;
    }

    let chat: ChatRef;
    let text: string;
    let replyMain: string | null = null;
    try {
      const target = await this.replyTarget(row);
      if ("error" in target) {
        await markFailed(row.id, target.error);
        return;
      }
      chat = target.chat;
      replyMain = target.replyMain;
      const body = await outboxBody(row);
      if ("error" in body) {
        await markFailed(row.id, body.error);
        return;
      }
      text = body.text.trim();
    } catch (err) {
      log.warn("zoom send target failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(row.id, "The conversation could not be loaded, so nothing was sent. Try again.").catch(() => undefined);
      return;
    }
    if (row.attachment_count > 0) {
      await markFailed(row.id, "Files cannot be sent to Zoom chats from here yet. Send them in Zoom.");
      return;
    }
    if (!text) {
      await markFailed(row.id, "There is nothing to send.");
      return;
    }
    if (text.length > MAX_MESSAGE_CHARS) {
      await markFailed(row.id, `Zoom chat messages can be at most ${MAX_MESSAGE_CHARS} characters. Shorten it and send again.`);
      return;
    }

    let sentId: string;
    try {
      const sent = await client.request<{ id?: string }>("/chat/users/me/messages", { method: "POST", body: sendBody(chat, text, replyMain) });
      if (!sent?.id) throw Object.assign(new Error("no message id"), { code: "NO_ID" });
      sentId = sent.id;
    } catch (err) {
      log.warn("zoom reply failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      // Zoom answers a refusal (a 4xx) before doing anything, so only then is it certain nothing went out.
      const refused = err instanceof ZoomApiError && err.status >= 400 && err.status < 500;
      await markFailed(
        row.id,
        rateLimited(err)
          ? "Zoom is busy, so nothing was sent. Try again in a minute."
          : refused
            ? "Zoom did not accept the message, so nothing was sent."
            : "The message may not have been sent. Check Zoom before sending again.",
      ).catch(() => undefined);
      return;
    }
    if (!(await settleSent(row.id, sentId))) log.warn("zoom reply sent but not recorded", { account: this.id, outbox: row.id });
    else log.info("zoom reply sent", { account: this.id, outbox: row.id });

    // Stored at once so it shows in the conversation; the next poll finds it stored already.
    try {
      const payload = await chatPayload(
        { id: sentId, message: text, sender: this.selfEmail, timestamp: Date.now(), ...(replyMain ? { reply_main_message_id: replyMain } : {}) },
        chat,
        { selfEmail: this.selfEmail },
        this.sealer(),
        false,
      );
      if (payload) await this.ingest(payload);
    } catch (err) {
      log.warn("store sent zoom failed", { account: this.id, outbox: row.id, code: errorCode(err) });
    }
  }

  /**
   * Read, archive and the rest stay in the app: Zoom's API cannot mark a chat read or archive it, and nothing
   * is sent to Zoom when you open a chat. A reaction cannot be sent yet, so it fails with a reason.
   */
  async applyAction(row: Tables<"mail_actions">) {
    await finishAction(row.id, row.action === "react" ? "Reactions cannot be sent to Zoom chats yet." : undefined);
  }

  /** The chat a reply goes to, which must be a Zoom chat on this account and yours, and the thread it answers. */
  private async replyTarget(row: OutboxRow): Promise<{ chat: ChatRef; replyMain: string | null } | { error: string }> {
    if (!row.thread_id) return { error: "New Zoom chats can only be started in Zoom for now." };
    const thread = must(
      await db.from("threads").select("account_id, user_id, channel, provider_thread_id, is_group, group_name").eq("id", row.thread_id).maybeSingle(),
      "load zoom thread",
    );
    await openAddresses(this.account.user_id, thread);
    if (!thread || thread.account_id !== this.id || thread.user_id !== row.user_id || thread.channel !== "zoom") {
      return { error: "This message belongs to another account." };
    }
    const chat: ChatRef = { id: thread.provider_thread_id, isGroup: thread.is_group, name: thread.group_name, peerEmail: null };
    if (!row.reply_to_message_id) return { chat, replyMain: null };
    const chosen = must(
      await db.from("messages").select("thread_id, provider_message_id, provider_meta").eq("id", row.reply_to_message_id).eq("account_id", this.id).maybeSingle(),
      "load zoom reply target",
    );
    if (!chosen || chosen.thread_id !== row.thread_id) return { chat, replyMain: null };
    // A reply to a reply goes into the same thread, under the message that started it.
    const main = (chosen.provider_meta as { reply_main?: string } | null)?.reply_main;
    return { chat, replyMain: main ?? chosen.provider_message_id };
  }
}

/** Meetings and their participants in the database, for RecordingSync. */
function meetingStore(accountId: string): MeetingStore {
  return {
    async find(uuids) {
      const found = new Map<string, StoredMeeting>();
      for (const batch of chunks(uuids, 100)) {
        const rows = must(
          await db.from("meetings").select("id, status, provider_meta, provider_meeting_id").eq("account_id", accountId).in("provider_meeting_id", batch),
          "load zoom meetings",
        );
        for (const r of rows) found.set(r.provider_meeting_id, r);
      }
      return found;
    },
    async save(row: TablesInsert<"meetings">) {
      return must(await db.from("meetings").upsert(row, { onConflict: "account_id,provider_meeting_id" }).select("id").single(), "save zoom meeting").id;
    },
    async update(id: string, patch: TablesUpdate<"meetings">) {
      must(await db.from("meetings").update(patch).eq("id", id).eq("account_id", accountId), "update zoom meeting");
    },
    async hasParticipants(meetingId) {
      return must(await db.from("meeting_participants").select("id").eq("meeting_id", meetingId).limit(1), "load meeting participants").length > 0;
    },
    async addParticipants(rows) {
      must(await db.from("meeting_participants").insert(rows), "save meeting participants");
    },
    async upload(path, bytes, contentType) {
      await uploadObject(ATTACHMENTS_BUCKET, path, bytes, contentType, WRITE_ONCE_CACHE_S);
    },
  };
}
