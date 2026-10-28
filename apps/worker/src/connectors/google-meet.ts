// Google Meet transcripts and Google Chat, from one google_meet account on the Google sign-in. Both need a
// Google Workspace account; a personal one is told so on the account instead of syncing nothing.
//
// Meet: every few minutes, the meetings that ended since the last look (conferenceRecords filtered on
// end_time), each with its participants and its transcript's entries, stored as a meetings row with the
// transcript as JSON segments and its participants. A meeting whose transcript is still being made is stored
// as waiting and looked at again. Linking meetings to contacts and calendar events, and summaries, happen
// elsewhere.
//
// Chat: every 30 seconds, the spaces with new messages since the last look (each space says when it last
// had one), and those messages (filtered on createTime), stored like WhatsApp chats. Google answering
// "too many requests" slows the polling down. Replies queued in the outbox are posted as you.

import type { Json, TablesInsert } from "@messages/db";
import { addressIndex, chatIndex } from "@messages/crypto/addresses";
import { isCiphertext } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { Backoff, SerialQueue, Sleeper } from "../backoff";
import { db, getSyncState, must, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { mapLimit } from "../util";
import { claimReady, markFailed, settleSent, type OutboxRow } from "../send/outbox";
import { keysFor, open, openAddresses, seal, sealAddress } from "../vault";
import { GoogleApiError, signInRevoked, type GoogleClient } from "../google/client";
import { CHAT_MESSAGES_SCOPE, CHAT_SPACES_SCOPE, GoogleAuthError, MEET_SCOPE } from "../google/oauth";
import { googleFatalDetail, openGoogleClient } from "../google/session";
import { PeopleLookup } from "../google/people";
import {
  MEET_API,
  NO_TRANSCRIPTS_HINT,
  PERSONAL_ACCOUNT,
  attendeesOf,
  conferenceFilter,
  entriesToSegments,
  eventForMeeting,
  isWorkspace,
  mapParticipants,
  meetReadProblem,
  meetingCodeOf,
  noTranscriptsLikely,
  transcriptReadiness,
  userIdOf,
  type ConferenceRecord,
  type MeetParticipant,
  type MeetSpace,
  type Transcript,
  type TranscriptEntry,
  type UserInfo,
} from "../google/meet";
import {
  CHAT_API,
  CHAT_NOT_GRANTED,
  CHAT_PAGE,
  MAX_CHAT_BYTES,
  buildChatSend,
  chatReadProblem,
  chatSendFailure,
  chatUserId,
  mapChatMessage,
  messagesFilter,
  spacesToRead,
  type ChatMessage,
  type ChatSpace,
  type MappedChat,
} from "../google/chat";

const MEET_POLL_MS = 5 * 60_000;
const CHAT_POLL_MS = 30_000;
const CHAT_SLOWEST_MS = 10 * 60_000;
/** After a Meet or Chat problem that needs setting up (an API off, no Chat app), how long before trying again. */
const RECHECK_MS = 30 * 60_000;
/** Each look reaches back this much before the last, so a message or meeting saved late is not missed. */
const OVERLAP_MS = 2 * 60_000;
const MEETINGS_AT_ONCE = 2;
/** A meeting Google would not give in full is tried again on later polls until it is this old. */
const GIVE_UP_MS = 2 * 24 * 60 * 60_000;
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const ME = "https://people.googleapis.com/v1/people/me";
const NO_SELF = "Google did not say which account signed in, so Google Chat is paused. Reconnect Google in Settings, Connected Accounts, and leave every box ticked.";

const SIGN_IN_EXPIRED = "Google sign-in expired or was removed. Reconnect Google in Settings, Connected Accounts.";

export class GoogleMeetConnector {
  private stopped = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  private readonly chatBackoff = new Backoff(CHAT_POLL_MS, CHAT_SLOWEST_MS);
  /** Chat messages are stored one at a time, so a poll and a sent reply never race to make one contact twice. */
  private readonly chatQueue = new SerialQueue();
  /** The signed-in client while a session is running; queued replies wait until there is one. */
  private client: GoogleClient | null = null;
  private people: PeopleLookup | null = null;
  /** Your Google ID and address, to know your own messages and your place in a meeting. */
  private self: { userId: string | null; email: string | null } = { userId: null, email: null };
  private canMeet = false;
  private canChat = false;
  private nextMeetAt = 0;
  /** Why Chat cannot be read, while it cannot, and when to try again. */
  private chatProblem: string | null = null;
  private chatRecheckAt = 0;
  /** Why Meet cannot be read, while it cannot. */
  private meetProblem: string | null = null;
  private meetHint: string | null = null;
  /** The status last written, so a quiet poll only touches the account. */
  private shown: string | null = null;

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
      try {
        await this.session();
      } catch (err) {
        if (this.stopped) break;
        const fatal = (err as { code?: string }).code === "PERSONAL" ? PERSONAL_ACCOUNT : googleFatalDetail(err, "Meet and Chat");
        if (fatal) {
          if (signInRevoked(err)) log.error("meet sign-in revoked", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", fatal).catch(() => undefined);
          return;
        }
        log.warn("meet sync failed", { account: this.id, code: errorCode(err) });
        await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
      }
      this.client = null;
      this.shown = null;
      if (this.stopped) break;
      await this.sleeper.wait(this.backoff.next());
    }
  }

  /** The sign-in, which must grant Meet or Chat or both. */
  private async open() {
    try {
      return await openGoogleClient(this.id, MEET_SCOPE);
    } catch (err) {
      if ((err as { code?: string }).code !== "NOT_GRANTED") throw err;
      return openGoogleClient(this.id, CHAT_MESSAGES_SCOPE);
    }
  }

  private async session() {
    await setAccountStatus(this.id, "connecting");
    const { client, creds } = await this.open();
    this.canMeet = creds.scopes.includes(MEET_SCOPE);
    this.canChat = creds.scopes.includes(CHAT_MESSAGES_SCOPE) && creds.scopes.includes(CHAT_SPACES_SCOPE);
    this.chatProblem = this.meetProblem = null;
    this.chatRecheckAt = this.nextMeetAt = 0;

    const info = await client.request<UserInfo>(USERINFO).catch(() => null);
    if (!isWorkspace(info, this.account.address)) throw Object.assign(new Error("personal google account"), { code: "PERSONAL" });
    // Your Google ID, from the sign-in or, for one made without openid, from the People API.
    const selfUserId = info?.sub ?? userIdOf(
      (await client.request<{ resourceName?: string }>(ME, { query: { personFields: "metadata" } }).catch(() => null))?.resourceName?.replace(/^people\//, "users/"),
    );
    this.self = { userId: selfUserId, email: (info?.email ?? this.account.address)?.toLowerCase() ?? null };
    if (!selfUserId && this.canChat) {
      // Without it your own Chat messages would look like someone else's.
      this.canChat = false;
      this.chatProblem = NO_SELF;
    }
    this.people = new PeopleLookup(client);
    this.client = client;

    await setAccountStatus(this.id, "syncing");
    while (!this.stopped) {
      if (this.canMeet && Date.now() >= this.nextMeetAt) {
        this.nextMeetAt = Date.now() + (await this.syncMeetSafely(client));
      }
      const wait = this.canChat ? await this.syncChat(client) : MEET_POLL_MS;
      this.backoff.reset();
      await this.showStatus();
      await this.sleeper.wait(wait);
    }
  }

  /** Connected, with anything worth knowing about Meet or Chat as the detail. */
  private async showStatus() {
    const detail = [this.meetProblem, this.chatProblem, this.meetHint].filter(Boolean).join(" ") || null;
    const key = `connected|${detail ?? ""}`;
    if (this.shown === key) {
      await touchAccount(this.id);
      return;
    }
    await setAccountStatus(this.id, "connected", detail);
    this.shown = key;
  }

  // ---------------------------------------------------------------------------
  // Meet
  // ---------------------------------------------------------------------------

  /**
   * One look for ended meetings. Returns how long until the next. A Cloud project without the Meet REST API
   * turned on answers 403 to everything, which is shown on the account and checked again later; Google saying
   * "too many requests" just waits for the next poll.
   */
  private async syncMeetSafely(client: GoogleClient): Promise<number> {
    try {
      await this.syncMeet(client);
      this.meetProblem = null;
      return MEET_POLL_MS;
    } catch (err) {
      if (!(err instanceof GoogleApiError)) throw err;
      if (err.status === 429) return MEET_POLL_MS;
      const problem = meetReadProblem(err.status, err.reason);
      if (!problem) throw err;
      log.warn("meet not readable", { account: this.id, code: errorCode(err) });
      this.meetProblem = problem;
      return RECHECK_MS;
    }
  }

  private async syncMeet(client: GoogleClient) {
    const startedAt = new Date().toISOString();
    const state = await getSyncState(this.id, "meet");
    const last = state?.sync_token ? Date.parse(state.sync_token) : Date.now() - env.initialSyncDays * 86_400_000;
    const since = new Date(last - OVERLAP_MS).toISOString();

    const records = new Map<string, ConferenceRecord>();
    let pageToken: string | undefined;
    do {
      const page = await client.request<{ conferenceRecords?: ConferenceRecord[]; nextPageToken?: string }>(`${MEET_API}/conferenceRecords`, {
        query: { filter: conferenceFilter(since), pageSize: 100, pageToken },
      });
      for (const r of page.conferenceRecords ?? []) if (r.name && r.endTime) records.set(r.name, r);
      pageToken = page.nextPageToken;
    } while (pageToken);

    // Meetings already stored are left alone, except those still waiting for their transcript.
    const stored = new Map<string, string>();
    for (const row of must(
      await db.from("meetings").select("provider_meeting_id, status").eq("account_id", this.id).eq("platform", "google_meet").gte("ended_at", since),
      "load stored meetings",
    )) stored.set(row.provider_meeting_id, row.status);
    const waiting = must(
      await db.from("meetings").select("provider_meeting_id").eq("account_id", this.id).eq("platform", "google_meet").eq("status", "waiting").limit(50),
      "load waiting meetings",
    );
    for (const { provider_meeting_id: name } of waiting) {
      if (records.has(name)) continue;
      try {
        records.set(name, await client.request<ConferenceRecord>(`${MEET_API}/${name}`));
      } catch (err) {
        if (!(err instanceof GoogleApiError && err.status === 404)) throw err;
        // Google keeps a meeting's record for 30 days.
        await this.failMeeting(name, "Google Meet no longer has this meeting.");
      }
    }

    const todo = [...records.values()].filter((r) => (stored.get(r.name) ?? "waiting") === "waiting");
    const outcomes = await mapLimit(todo, MEETINGS_AT_ONCE, (record) => this.storeMeeting(client, record));
    await saveSyncState(this.id, "meet", { sync_token: startedAt });

    const recent = must(
      await db.from("meetings").select("status").eq("account_id", this.id).eq("platform", "google_meet").order("started_at", { ascending: false }).limit(10),
      "load recent meetings",
    );
    this.meetHint = noTranscriptsLikely(recent.map((m) => m.status)) ? NO_TRANSCRIPTS_HINT : null;
    if (todo.length > 0) {
      const count = (s: string) => outcomes.filter((o) => o === s).length;
      log.info("meet synced", { account: this.id, meetings: todo.length, transcribed: count("transcribed"), waiting: count("waiting"), none: count("no_transcript") });
    }
  }

  /** Stores one meeting, its participants and, once it is ready, its transcript. Returns the status it was stored with. */
  private async storeMeeting(client: GoogleClient, record: ConferenceRecord): Promise<string> {
    try {
      const space = record.space ? await client.request<MeetSpace>(`${MEET_API}/${record.space}`).catch(() => null) : null;
      const participants = await this.listAll<MeetParticipant>(client, `${MEET_API}/${record.name}/participants`, "participants");
      // A meeting someone else organised may not let you see its transcript, which reads as none.
      const transcripts = await this.listAll<Transcript>(client, `${MEET_API}/${record.name}/transcripts`, "transcripts").catch((err) => {
        if (err instanceof GoogleApiError && (err.status === 403 || err.status === 404)) return [];
        throw err;
      });
      const readiness = transcriptReadiness(transcripts, record.endTime);

      const startedAt = record.startTime ?? record.endTime!;
      const meetingCode = meetingCodeOf(space);
      const event = await this.calendarEvent(meetingCode, startedAt);
      const signedIn = participants.map((p) => userIdOf(p.signedinUser?.user)).filter((id): id is string => !!id && id !== this.self.userId);
      const found = this.people ? await this.people.find(signedIn) : new Map();
      const emailsByUser = new Map([...found].flatMap(([id, info]) => (info.email ? [[id, info.email] as const] : [])));
      const mapped = mapParticipants(participants, { selfUserId: this.self.userId, selfEmail: this.self.email, attendees: event?.attendees ?? [], emailsByUser });

      let transcript: string | null = null;
      // Ready but empty counts as none: transcription was on, but nobody spoke.
      let status: "transcribed" | "waiting" | "no_transcript" = readiness === "waiting" ? "waiting" : "no_transcript";
      if (readiness === "ready") {
        const entries: TranscriptEntry[] = [];
        for (const t of [...transcripts].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))) {
          entries.push(...(await this.listAll<TranscriptEntry>(client, `${MEET_API}/${t.name}/entries`, "transcriptEntries")));
        }
        const segments = entriesToSegments(entries, { startedAt, speakers: new Map(mapped.map((m) => [m.key, m.name])) });
        if (segments.length > 0) {
          transcript = JSON.stringify(segments);
          status = "transcribed";
        }
      }

      const userId = this.account.user_id;
      const row: TablesInsert<"meetings"> = {
        user_id: userId,
        account_id: this.id,
        platform: "google_meet",
        provider_meeting_id: record.name,
        title: await seal(userId, FIELD.meetingTitle, event?.title ?? null),
        started_at: new Date(startedAt).toISOString(),
        ended_at: record.endTime ? new Date(record.endTime).toISOString() : null,
        transcript: await seal(userId, FIELD.transcript, transcript),
        transcript_source: status === "transcribed" ? "provider" : null,
        status,
        error: null,
        provider_meta: { join_url: space?.meetingUri ?? null, conference_record: record.name, space: record.space ?? null, meeting_code: meetingCode } satisfies Json,
      };
      const meeting = must(await db.from("meetings").upsert(row, { onConflict: "account_id,provider_meeting_id" }).select("id").single(), "save meeting");

      must(await db.from("meeting_participants").delete().eq("meeting_id", meeting.id), "clear meeting participants");
      if (mapped.length > 0) {
        const people = await Promise.all(
          mapped.map(async (m) => ({
            meeting_id: meeting.id,
            user_id: userId,
            name: await seal(userId, FIELD.name, m.name),
            address: await sealAddress(userId, m.address),
            is_self: m.isSelf,
          })),
        );
        must(await db.from("meeting_participants").insert(people), "save meeting participants");
      }
      return status;
    } catch (err) {
      log.warn("meet meeting failed", { account: this.id, code: errorCode(err) });
      if (err instanceof GoogleAuthError) throw err;
      const ended = Date.parse(record.endTime ?? "");
      if (Date.now() - ended > GIVE_UP_MS) await this.failMeeting(record.name, "Google Meet did not return this meeting's transcript.", record);
      else await this.keepWaiting(record);
      return "waiting";
    }
  }

  /** Every item of a Meet list, a page at a time. */
  private async listAll<T>(client: GoogleClient, url: string, key: string): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
      const page = await client.request<Record<string, unknown> & { nextPageToken?: string }>(url, { query: { pageSize: 100, pageToken } });
      items.push(...((page[key] as T[] | undefined) ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  /** The calendar event a meeting was held for, by its Meet link and time: only its guests' addresses and title are used. */
  private async calendarEvent(meetingCode: string | null, startedAt: string) {
    if (!meetingCode || !/^[a-z0-9-]+$/i.test(meetingCode)) return null;
    const at = Date.parse(startedAt);
    const events = must(
      await db
        .from("calendar_events")
        .select("id, title, starts_at, conference_url, attendees")
        .eq("user_id", this.account.user_id)
        .ilike("conference_url", `%${meetingCode}%`)
        .gte("starts_at", new Date(at - 12 * 3_600_000).toISOString())
        .lte("starts_at", new Date(at + 12 * 3_600_000).toISOString())
        .limit(20),
      "load meeting's event",
    );
    const event = eventForMeeting(events, { meetingCode, startedAt });
    if (!event) return null;
    return {
      title: (await open(this.account.user_id, FIELD.eventTitle, event.title)) || null,
      attendees: attendeesOf(event.attendees).filter((a) => !isCiphertext(a.email)),
    };
  }

  /** A meeting Google could not give in full this time: stored as waiting, so the next poll tries again. */
  private async keepWaiting(record: ConferenceRecord) {
    const exists = must(await db.from("meetings").select("id").eq("account_id", this.id).eq("provider_meeting_id", record.name).maybeSingle(), "find meeting");
    if (exists || !record.startTime) return;
    await db.from("meetings").insert({
      user_id: this.account.user_id,
      account_id: this.id,
      platform: "google_meet",
      provider_meeting_id: record.name,
      started_at: new Date(record.startTime).toISOString(),
      ended_at: record.endTime ? new Date(record.endTime).toISOString() : null,
      status: "waiting",
      provider_meta: { conference_record: record.name, space: record.space ?? null },
    });
  }

  private async failMeeting(name: string, reason: string, record?: ConferenceRecord) {
    if (record) await this.keepWaiting(record);
    must(
      await db.from("meetings").update({ status: "failed", error: reason }).eq("account_id", this.id).eq("provider_meeting_id", name).eq("status", "waiting"),
      "fail meeting",
    );
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  /** One look for new Chat messages. Returns how long to wait before the next. */
  private async syncChat(client: GoogleClient): Promise<number> {
    if (this.chatProblem && Date.now() < this.chatRecheckAt) return Math.min(MEET_POLL_MS, this.chatRecheckAt - Date.now());
    try {
      await this.readChat(client);
      this.chatProblem = null;
      this.chatBackoff.reset();
      return CHAT_POLL_MS;
    } catch (err) {
      if (!(err instanceof GoogleApiError)) throw err;
      if (err.status === 429 || (err.status === 403 && err.reason === "RESOURCE_EXHAUSTED")) {
        const wait = this.chatBackoff.next();
        log.warn("chat rate limited", { account: this.id, inMs: wait });
        return wait;
      }
      const problem = chatReadProblem(err.status, err.reason);
      if (!problem) throw err;
      log.warn("chat not readable", { account: this.id, code: errorCode(err) });
      this.chatProblem = problem;
      this.chatRecheckAt = Date.now() + RECHECK_MS;
      return MEET_POLL_MS;
    }
  }

  private async readChat(client: GoogleClient) {
    const startedAt = new Date().toISOString();
    const state = await getSyncState(this.id, "chat");
    // The first look brings in recent history as read; after that, new messages from others arrive unread.
    const first = !state?.sync_token;
    const last = state?.sync_token ? Date.parse(state.sync_token) : Date.now() - env.initialSyncDays * 86_400_000;
    const since = new Date(last - OVERLAP_MS).toISOString();

    const spaces: ChatSpace[] = [];
    let pageToken: string | undefined;
    do {
      const page = await client.request<{ spaces?: ChatSpace[]; nextPageToken?: string }>(`${CHAT_API}/spaces`, { query: { pageSize: 1000, pageToken } });
      spaces.push(...(page.spaces ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    let inserted = 0;
    for (const space of spacesToRead(spaces, since)) {
      if (this.stopped) return;
      const messages: ChatMessage[] = [];
      let token: string | undefined;
      do {
        const page = await client.request<{ messages?: ChatMessage[]; nextPageToken?: string }>(`${CHAT_API}/${space.name}/messages`, {
          query: { filter: messagesFilter(since), pageSize: CHAT_PAGE, pageToken: token },
        });
        messages.push(...(page.messages ?? []));
        token = page.nextPageToken;
      } while (token);
      inserted += await this.storeChat(messages, space, { live: !first });
    }
    await saveSyncState(this.id, "chat", { sync_token: startedAt });
    if (inserted > 0) log.info("chat messages stored", { account: this.id, inserted });
  }

  /** Stores Chat messages from one space, in order. Returns how many were new. */
  private async storeChat(messages: ChatMessage[], space: ChatSpace, opts: { live: boolean; sentByMe?: boolean }): Promise<number> {
    const unnamed = messages
      .map((m) => chatUserId(m.sender?.name))
      .filter((id): id is string => !!id && id !== this.self.userId);
    const people = this.people ? await this.people.find(unnamed) : new Map();
    let inserted = 0;
    await this.chatQueue.run(async () => {
      for (const message of messages) {
        const senderId = chatUserId(message.sender?.name);
        const known = senderId ? people.get(senderId) : undefined;
        const mapped = mapChatMessage(message, { space, selfUserId: this.self.userId, senderName: known?.name, sentByMe: opts.sentByMe });
        if (!mapped) continue;
        try {
          const stored = must(
            await db.rpc("ingest_google_chat", { p_account_id: this.id, p_msg: await this.chatPayload(mapped, known?.email ?? null, opts) }),
            "ingest google chat",
          ) as { result?: string };
          if (stored.result === "inserted") inserted++;
        } catch (err) {
          log.warn("chat message failed", { account: this.id, code: errorCode(err) });
        }
      }
    });
    return inserted;
  }

  /** A Chat message as public.ingest_google_chat takes it, with its addresses sealed and indexed. */
  private async chatPayload(m: MappedChat, email: string | null, opts: { live: boolean }): Promise<Json> {
    const userId = this.account.user_id;
    const keys = await keysFor(userId);
    const person = m.fromMe || !m.senderUser
      ? null
      : {
          address: await sealAddress(userId, email),
          index: email ? await addressIndex(keys, email) : null,
          display_name: m.senderName,
          user_index: await addressIndex(keys, m.senderUser),
        };
    return {
      provider_message_id: m.providerMessageId,
      space: await sealAddress(userId, m.space),
      space_index: await chatIndex(keys, m.space),
      is_group: m.isGroup,
      group_name: m.groupName,
      status: "inbox",
      resurface: opts.live && !m.fromMe,
      sent_at: m.sentAt,
      direction: m.fromMe ? "outbound" : "inbound",
      is_read: m.fromMe || !opts.live,
      sender: person,
      sender_address: await sealAddress(userId, m.senderUser),
      sender_index: m.senderUser ? await addressIndex(keys, m.senderUser) : null,
      // In a direct message the other person is the conversation's; in a group, everyone who writes is.
      participants: person ? [person] : [],
      preview: await seal(userId, FIELD.preview, m.preview),
      body_text: await seal(userId, FIELD.body, m.body),
      provider_meta: { space: await sealAddress(userId, m.space), from_me: m.fromMe, ...(m.thread ? { thread: m.thread } : {}), ...(m.quoted ? { quoted_name: m.quoted } : {}) },
    };
  }

  /**
   * Posts one queued reply in its Google Chat conversation as you, then stores it so it shows at once. Text only:
   * Chat takes files from people only through its own upload, which is not built. Claimed first, so it can never
   * go out twice; the row's id is also Chat's request ID, so a retried request returns the same message.
   */
  async send(queuedRow: OutboxRow) {
    const client = this.client;
    if (!client || this.stopped) return; // still connecting: picked up on the next pass
    const row = await claimReady(queuedRow);
    if (!row) return;
    if (!this.canChat) return markFailed(row.id, this.chatProblem ?? CHAT_NOT_GRANTED);
    if (row.attachment_count > 0) return markFailed(row.id, "Files cannot be sent to Google Chat yet. Send the text on its own.");
    if (!row.thread_id) return markFailed(row.id, "New Google Chat conversations cannot be started here yet. Reply in one instead.");

    let target: { space: ChatSpace; thread: string | null; text: string };
    try {
      const thread = await openAddresses(
        row.user_id,
        must(await db.from("threads").select("account_id, user_id, channel, provider_thread_id, is_group, group_name").eq("id", row.thread_id).maybeSingle(), "load chat thread"),
      );
      if (!thread || thread.account_id !== this.id || thread.user_id !== row.user_id || thread.channel !== "google_chat") {
        return markFailed(row.id, "This message belongs to another account.");
      }
      const text = ((await open(row.user_id, FIELD.body, row.body)) ?? "").trim();
      if (!text) return markFailed(row.id, "There is nothing to send.");
      if (Buffer.byteLength(text) > MAX_CHAT_BYTES) return markFailed(row.id, "This message is too long for Google Chat. Shorten it and send again.");
      // A reply to one message in a named space goes in that message's thread.
      const replyTo = row.reply_to_message_id
        ? must(await db.from("messages").select("provider_meta").eq("id", row.reply_to_message_id).eq("thread_id", row.thread_id).maybeSingle(), "load chat reply target")
        : null;
      const threadName = (replyTo?.provider_meta as { thread?: unknown } | null)?.thread;
      target = {
        space: { name: thread.provider_thread_id, spaceType: thread.is_group ? (thread.group_name ? "SPACE" : "GROUP_CHAT") : "DIRECT_MESSAGE", displayName: thread.group_name ?? undefined },
        thread: typeof threadName === "string" ? threadName : null,
        text,
      };
    } catch (err) {
      log.warn("chat send target failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(row.id, "Google Chat could not be reached, so nothing was sent. Try again.").catch(() => undefined);
      return;
    }

    const request = buildChatSend({ space: target.space.name, text: target.text, requestId: row.id, thread: target.thread });
    let sent: ChatMessage;
    try {
      sent = await client.request<ChatMessage>(request.url, { method: "POST", query: request.query, body: request.body, timeoutMs: 30_000 });
    } catch (err) {
      log.warn("chat reply failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      // A sign-in that failed never reached Chat.
      const reason = err instanceof GoogleAuthError
        ? signInRevoked(err) ? SIGN_IN_EXPIRED : "Google Chat could not be reached, so nothing was sent. Try again."
        : chatSendFailure(err instanceof GoogleApiError ? err.status : null, err instanceof GoogleApiError ? err.reason : null);
      await markFailed(row.id, reason).catch(() => undefined);
      return;
    }
    if (!(await settleSent(row.id, sent.name))) log.warn("chat reply sent but not recorded", { account: this.id, outbox: row.id });
    else log.info("chat reply sent", { account: this.id, outbox: row.id });
    // Your own message, as Chat returned it. If this fails, the next poll stores it.
    await this.storeChat([sent], target.space, { live: true, sentByMe: true }).catch((err) =>
      log.warn("store sent chat failed", { account: this.id, outbox: row.id, code: errorCode(err) }),
    );
  }
}
