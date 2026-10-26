import type { Json, Tables, TablesUpdate } from "@messages/db";
import type { UserKeys } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { addressIndex, chatIndex, domainIndex } from "@messages/crypto/addresses";
import { companyDomain, companyNameForDomain } from "@messages/email-text/company";
import { Backoff, SerialQueue, Sleeper } from "../backoff";
import { db, getSyncState, must, saveSyncState, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { chunks } from "../util";
import { normAddresses } from "../send/from-address";
import { finishAction } from "../send/actions";
import { claimReady, markFailed, settleSent, type OutboxRow } from "../send/outbox";
import { nameFromAddress } from "../ingest/normalize-email";
import { ownIdentitiesCached } from "../contacts/own";
import { keysFor, open, openAddresses, seal, sealAddress, sealDomain } from "../vault";
import { GraphApiError, signInRevoked, type GraphClient, type GraphRequest } from "../microsoft/client";
import { CALENDAR_SCOPE, CHAT_SCOPE, MEETINGS_SCOPE, TRANSCRIPT_SCOPE } from "../microsoft/oauth";
import { microsoftFatalDetail, openGraphClient } from "../microsoft/session";
import {
  changedChats,
  graphTime,
  inboundRead,
  isGroupChat,
  lastActivity,
  markChatRead,
  memberOf,
  messageContent,
  oneLine,
  postReply,
  reactionsOf,
  sendFailure,
  storedMessageId,
  teamsAccessProblem,
  type GraphChat,
  type GraphChatMessage,
  type GraphMember,
  type Member,
} from "../teams/chat";
import { gaveUp, joinUrlFilter, newSpeakers, teamsMeetings, transcriptCheckDue, transcriptsFor, type CallTranscript, type MeetingEvent, type MeetingPerson } from "../teams/meetings";
import { joinTranscripts, parseVtt } from "../teams/vtt";

// Microsoft Teams through Microsoft Graph, on the same Microsoft sign-in as Outlook with the Teams
// permissions added (pnpm connect:microsoft asks). Your one-to-one, group and meeting chats are stored as
// conversations like WhatsApp chats, with people matched by their work address like email. Graph's change
// notifications need a public web address, so chats are polled: the chat list, newest message first, says
// which chats changed since the last check, and only those are read. A reply queued in the app is posted to
// its chat. Nothing is marked read in Teams unless you open the chat in the app.
//
// Meetings: your Outlook Calendar's Teams meetings are found by their join links. Once one ends its
// transcript is looked for, again and again for a few hours since Teams writes it late, and stored in
// meetings with the people who were there. Summaries and linking to contacts and events happen elsewhere.

const POLL_MS = 15_000;
const MAX_FAILED_CHECKS = 8; // about two minutes of checks failing in a row
const CHATS_PAGE = 50; // the most Graph gives per page of chats or messages
const FIRST_SYNC_MESSAGES = 200; // per chat: the newest ones in the import window
/** Each check reads a little before the last one's newest message, as Graph's times can land late. */
const SKEW_MS = 2 * 60_000;
const TOUCH_MS = 60_000;
const MEETINGS_EVERY_MS = 5 * 60_000;
/** The first look for meetings reaches back a week, so recent transcripts show at once. */
const FIRST_MEETINGS_MS = 7 * 86_400_000;
/** Later ones go back a day before the last, in case a meeting was moved or the worker was off. */
const MEETINGS_OVERLAP_MS = 86_400_000;
const EVENT_SELECT = "id,iCalUId,subject,isAllDay,isCancelled,start,end,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,responseStatus,attendees,organizer";
const SELF = "me"; // who you are in provider_meta.reactions, as for WhatsApp

const NOT_FOUND = "This meeting was not found in your Teams, so its transcript cannot be read. It may belong to another organisation.";
const NOT_SHARED = "Microsoft did not share this meeting's transcript. Often only the organiser can read it, or your IT admin has not allowed it.";

/** A type, not an interface, so it counts as JSON for provider_meta. */
type TeamsMeetingMeta = {
  join_url?: string;
  online_meeting_id?: string | null;
  event_id?: string;
  ical_uid?: string | null;
  transcript_ids?: string[];
};

/** What public.ingest_teams returns for one message. */
type TeamsStored = { result: "inserted" | "updated"; message_id?: string; thread_id?: string };

async function ingestTeams(accountId: string, payload: Json): Promise<TeamsStored> {
  return must(await db.rpc("ingest_teams", { p_account_id: accountId, p_msg: payload }), "ingest teams") as TeamsStored;
}

type WaitingMeeting = Pick<Tables<"meetings">, "id" | "started_at" | "ended_at" | "provider_meta">;

export class TeamsConnector {
  private client: GraphClient | null = null;
  private stopped = false;
  private ready = false;
  private readonly sleeper = new Sleeper();
  private readonly backoff = new Backoff();
  /** Chat checks and the replies stored after sending run one at a time, so they never race. */
  private readonly queue = new SerialQueue();
  private me = { userId: "", name: null as string | null };
  private selfAddresses = new Set<string>();
  /** The newest message stored so far, as an ISO time: the next check reads chats with anything after it. */
  private cursor: string | null = null;
  /** Each chat's members, kept until Teams says they changed. */
  private readonly members = new Map<string, { stamp: string | null; members: Map<string, Member> }>();
  /** Each chat's Teams read point as last applied here. */
  private readonly readPoints = new Map<string, string>();
  private tenantId: string | null = null;
  private withMeetings = false;
  private meetingsRunning = false;
  /** When each meeting waiting for its transcript was last checked. */
  private readonly checkedAt = new Map<string, number>();

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
        // A revoked sign-in, an IT admin's approval still missing or Teams refused: retrying cannot fix
        // these, so stop until the connect command or a restart does.
        const fatal = teamsAccessProblem(err, true) ?? microsoftFatalDetail(err, "Teams");
        if (fatal) {
          log.error("teams cannot connect", { account: this.id, code: errorCode(err) });
          await setAccountStatus(this.id, "error", fatal);
          return;
        }
        log.warn("teams session failed", { account: this.id, code: errorCode(err) });
        await setAccountStatus(this.id, "connecting", "Connection lost. Reconnecting.").catch(() => undefined);
      }
      this.ready = false;
      if (this.stopped) break;
      const delay = this.backoff.next();
      log.info("teams reconnecting", { account: this.id, inMs: delay });
      await this.sleeper.wait(delay);
    }
  }

  /** One session: catch up on every chat with something new, then check again every few seconds. */
  private async session() {
    await setAccountStatus(this.id, "connecting");
    const { client, creds } = await openGraphClient(this.id, [CHAT_SCOPE]);
    this.client = client;
    this.queue.reset();
    this.withMeetings = [CALENDAR_SCOPE, MEETINGS_SCOPE, TRANSCRIPT_SCOPE].every((s) => creds.scopes.includes(s));

    const me = await client.request<{ id?: string; displayName?: string | null; mail?: string | null; userPrincipalName?: string | null }>("/me", {
      query: { $select: "id,displayName,mail,userPrincipalName" },
    });
    if (!me.id) throw Object.assign(new Error("no user id"), { code: "NO_USER_ID" });
    this.me = { userId: me.id, name: me.displayName?.trim() || null };
    this.selfAddresses = new Set(normAddresses([this.account.address, me.mail, me.userPrincipalName?.includes("@") ? me.userPrincipalName : null]));
    this.backoff.reset();
    log.info("teams connected", { account: this.id, meetings: this.withMeetings });

    await setAccountStatus(this.id, "syncing");
    this.cursor = (await getSyncState(this.id, "chats"))?.sync_token ?? null;
    await this.queue.run(() => this.check());
    await setAccountStatus(this.id, "connected");
    this.ready = true;

    let lastTouch = Date.now();
    let lastMeetings = 0;
    let failures = 0;
    while (!this.stopped) {
      if (this.withMeetings && Date.now() - lastMeetings >= MEETINGS_EVERY_MS) {
        lastMeetings = Date.now();
        this.meetingsInBackground();
      }
      await this.sleeper.wait(POLL_MS);
      if (this.stopped) break;
      // One failed check (throttling past its retries, a database hiccup) is retried at the next one. A
      // revoked sign-in or Teams refused ends the session at once, and a run of failures ends it too.
      try {
        await this.queue.run(() => this.check());
        failures = 0;
      } catch (err) {
        if (signInRevoked(err) || teamsAccessProblem(err, true) || ++failures >= MAX_FAILED_CHECKS) throw err;
        log.warn("teams check failed", { account: this.id, code: errorCode(err), failures });
      }
      if (Date.now() - lastTouch > TOUCH_MS) {
        lastTouch = Date.now();
        await touchAccount(this.id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Chats
  // ---------------------------------------------------------------------------

  /**
   * Reads the chats with a message since the cursor, oldest change first, and stores what is new. The first
   * check reaches back over the import window. The cursor moves only past chats that were read, so a failure
   * reads them again; a chat you were removed from is skipped.
   */
  private async check() {
    const client = this.need();
    const history = !this.cursor;
    const since = this.cursor ? Date.parse(this.cursor) - SKEW_MS : Date.now() - env.initialSyncDays * 86_400_000;

    const changed: GraphChat[] = [];
    let listed: GraphChat[] | null = null;
    let url: string | undefined = "/me/chats";
    let query: GraphRequest["query"] = { $expand: "lastMessagePreview", $orderby: "lastMessagePreview/createdDateTime desc", $top: CHATS_PAGE };
    while (url) {
      const page: { value?: GraphChat[]; "@odata.nextLink"?: string } = await client.request(url, { query });
      const chats = page.value ?? [];
      listed ??= chats;
      const found = changedChats(chats, since, !!page["@odata.nextLink"]);
      changed.push(...found.changed);
      url = found.more ? page["@odata.nextLink"] : undefined;
      query = undefined; // a next link carries its own
    }

    let newest = this.cursor ? Date.parse(this.cursor) : since;
    let inserted = 0;
    for (const chat of changed.reverse()) {
      if (this.stopped) return;
      try {
        inserted += await this.syncChat(chat, since, history);
      } catch (err) {
        if (!(err instanceof GraphApiError && (err.status === 403 || err.status === 404))) {
          await this.saveCursor(newest);
          throw err;
        }
        log.warn("teams chat skipped", { account: this.id, code: errorCode(err) });
      }
      newest = Math.max(newest, lastActivity(chat));
    }
    await this.saveCursor(newest);
    // Chats read in Teams are read here too. Only the most recent page: an older chat read in Teams is rare.
    for (const chat of listed ?? []) await this.applyReadPoint(chat);
    if (inserted > 0 || history) log.info("teams chats synced", { account: this.id, chats: changed.length, inserted, first: history });
  }

  private async saveCursor(ms: number) {
    const value = new Date(ms).toISOString();
    if (this.cursor && Date.parse(this.cursor) >= ms) return;
    await saveSyncState(this.id, "chats", { sync_token: value });
    this.cursor = value;
  }

  /** Stores one chat's messages changed since `since`, oldest first. Returns how many were new. */
  private async syncChat(chat: GraphChat, since: number, history: boolean): Promise<number> {
    const client = this.need();
    const members = await this.membersOf(chat);
    const messages: GraphChatMessage[] = [];
    // Newest change first, the only order Graph filters by time in; an edit or deletion counts as a change.
    let url: string | undefined = `/chats/${encodeURIComponent(chat.id)}/messages`;
    let query: GraphRequest["query"] = { $top: CHATS_PAGE, $orderby: "lastModifiedDateTime desc", $filter: `lastModifiedDateTime gt ${graphTime(since)}` };
    while (url && !this.stopped) {
      const page: { value?: GraphChatMessage[]; "@odata.nextLink"?: string } = await client.request(url, { query });
      messages.push(...(page.value ?? []));
      url = page["@odata.nextLink"];
      query = undefined;
      if (history && messages.length >= FIRST_SYNC_MESSAGES) break;
    }
    messages.sort((a, b) => Date.parse(a.createdDateTime ?? "") - Date.parse(b.createdDateTime ?? ""));

    const index = await chatIndex(await keysFor(this.account.user_id), chat.id);
    let inserted = 0;
    for (const msg of messages) {
      // One message that cannot be stored is logged and skipped, as for WhatsApp, so it never holds up the chat.
      try {
        const payload = await this.payload(chat, index, members, msg, history);
        if (payload && (await ingestTeams(this.id, payload)).result === "inserted") inserted++;
      } catch (err) {
        log.warn("teams message failed", { account: this.id, code: errorCode(err) });
      }
    }
    return inserted;
  }

  /** A chat's members by Entra user ID, read again only when Teams says they changed. */
  private async membersOf(chat: GraphChat): Promise<Map<string, Member>> {
    const stamp = chat.lastUpdatedDateTime ?? null;
    const known = this.members.get(chat.id);
    if (known && known.stamp === stamp) return known.members;
    const out = new Map<string, Member>();
    let url: string | undefined = `/chats/${encodeURIComponent(chat.id)}/members`;
    while (url) {
      const page: { value?: GraphMember[]; "@odata.nextLink"?: string } = await this.need().request(url);
      for (const raw of page.value ?? []) {
        const member = memberOf(raw);
        if (member) out.set(member.userId, member);
      }
      url = page["@odata.nextLink"];
    }
    this.members.set(chat.id, { stamp, members: out });
    return out;
  }

  /** Marks messages read here up to the chat's read point in Teams, when it moved since last time. */
  private async applyReadPoint(chat: GraphChat) {
    const until = chat.viewpoint?.lastMessageReadDateTime;
    if (!until || this.readPoints.get(chat.id) === until) return;
    const index = await chatIndex(await keysFor(this.account.user_id), chat.id);
    const changed = must(await db.rpc("teams_mark_read", { p_account_id: this.id, p_chat_index: index, p_until: until }), "mark teams chat read");
    this.readPoints.set(chat.id, until);
    if (changed > 0) log.info("teams chat read in teams", { account: this.id, messages: changed });
  }

  /** A person as public.ingest_teams takes them, the way email participants are: address, index and company. */
  private async person(keys: UserKeys, email: string, name: string | null) {
    const user = this.account.user_id;
    const domain = companyDomain(email, await ownIdentitiesCached(user));
    return {
      address: await sealAddress(user, email),
      index: await addressIndex(keys, email),
      display_name: name || nameFromAddress(email),
      company: domain ? { index: await domainIndex(keys, domain), domain: await sealDomain(user, domain), name: companyNameForDomain(domain) } : null,
    };
  }

  /** Reactions as provider_meta keeps them for WhatsApp: by "me" or the index of who reacted, with who each index is. */
  private async reactions(keys: UserKeys, msg: GraphChatMessage, members: Map<string, Member>) {
    const reactions: Record<string, string> = {};
    const reactors: Record<string, string> = {};
    for (const r of reactionsOf(msg)) {
      if (r.userId === this.me.userId) {
        reactions[SELF] = r.emoji;
        continue;
      }
      const email = members.get(r.userId)?.email;
      if (!email) continue;
      const key = await addressIndex(keys, email);
      reactions[key] = r.emoji;
      reactors[key] = await sealAddress(this.account.user_id, email);
    }
    return Object.keys(reactions).length ? { reactions, reactors } : {};
  }

  /** The JSON public.ingest_teams takes for one message, or null for a system event or an empty message. */
  private async payload(chat: GraphChat, index: string, members: Map<string, Member>, msg: GraphChatMessage, history: boolean): Promise<Json | null> {
    const content = messageContent(msg);
    if (!content || !msg.createdDateTime) return null;
    const user = this.account.user_id;
    const keys = await keysFor(user);
    const group = isGroupChat(chat);
    const fromId = msg.from?.user?.id ?? null;
    const outbound = fromId === this.me.userId;
    const member = fromId ? members.get(fromId) : undefined;
    const senderEmail = outbound ? null : (member?.email ?? null);
    const senderName = msg.from?.user?.displayName?.trim() || member?.name || msg.from?.application?.displayName?.trim() || null;
    const read = outbound || inboundRead(msg.createdDateTime, chat, history);
    const others = [...members.values()].filter((m) => m.userId !== this.me.userId && m.email);

    // A quoted reply keeps what it quotes in provider_meta.quoted, as WhatsApp's do, which the app shows as a quote block.
    const quoted = content.quoted && {
      id: storedMessageId(index, content.quoted.id),
      from_me: content.quoted.authorId === this.me.userId,
      author: content.quoted.authorId === this.me.userId ? "You" : (content.quoted.author ?? "Someone"),
      text: (await seal(user, FIELD.quote, content.quoted.text)) ?? "",
    };
    const meta = {
      chat: await sealAddress(user, chat.id),
      graph_id: msg.id,
      // When Teams last changed it: an edit, deletion or reaction since makes ingest_teams store it again.
      modified: msg.lastModifiedDateTime ?? msg.createdDateTime,
      ...(content.edited ? { edited: true } : {}),
      ...(content.deleted ? { deleted: true } : {}),
      ...(quoted ? { quoted } : {}),
      ...(await this.reactions(keys, msg, members)),
    };
    const preview = group && !outbound && senderName ? `${senderName}: ${content.preview}` : content.preview;

    return {
      provider_message_id: storedMessageId(index, msg.id),
      chat_id: await sealAddress(user, chat.id),
      chat_index: index,
      is_group: group,
      group_name: group ? chat.topic?.trim() || null : null,
      // A chat you hid in Teams starts archived; a new message brings it back, as in Teams.
      status: history && chat.viewpoint?.isHidden ? "archived" : "inbox",
      resurface: !history && !outbound,
      sent_at: new Date(msg.createdDateTime).toISOString(),
      direction: outbound ? "outbound" : "inbound",
      is_read: read,
      sender: senderEmail ? await this.person(keys, senderEmail, senderName) : null,
      sender_address: await sealAddress(user, senderEmail),
      sender_index: senderEmail ? await addressIndex(keys, senderEmail) : null,
      // A one-to-one chat is with its other member; a group's people are added as they write, as for WhatsApp.
      participants: group ? [] : await Promise.all(others.map((m) => this.person(keys, m.email!, m.name))),
      preview: await seal(user, FIELD.preview, oneLine(preview)),
      body_text: await seal(user, FIELD.body, content.text),
      body_marks: await seal(user, FIELD.marks, content.marks.length ? JSON.stringify(content.marks) : null),
      provider_meta: meta as Json,
    } satisfies Record<string, Json>;
  }

  // ---------------------------------------------------------------------------
  // Replies and read state
  // ---------------------------------------------------------------------------

  /**
   * Posts one queued reply to its Teams chat, then stores it so it shows in the conversation at once.
   * Claimed first, so it can never go out twice. New chats and files are not supported yet.
   */
  async send(queuedRow: OutboxRow) {
    if (!this.ready) return; // still connecting: the next poll retries it
    const row = await claimReady(queuedRow);
    if (!row) return;
    if (!row.thread_id) {
      await markFailed(row.id, "New Teams chats cannot be started from here yet. Reply in an existing chat instead.");
      return;
    }
    if (row.attachment_count > 0) {
      await markFailed(row.id, "Files cannot be sent to Teams from here yet. Send the text on its own, or share the file in Teams.");
      return;
    }
    let thread: { provider_thread_id: string; provider_thread_index: string; is_group: boolean; group_name: string | null };
    let text: string;
    try {
      const found = must(
        await db.from("threads").select("account_id, user_id, channel, provider_thread_id, provider_thread_index, is_group, group_name").eq("id", row.thread_id).maybeSingle(),
        "load teams thread",
      );
      await openAddresses(this.account.user_id, found);
      if (!found || found.account_id !== this.id || found.user_id !== row.user_id || found.channel !== "teams" || !found.provider_thread_index) {
        await markFailed(row.id, "This message belongs to another account.");
        return;
      }
      thread = { ...found, provider_thread_index: found.provider_thread_index };
      text = (await open(row.user_id, FIELD.body, row.body)) ?? "";
    } catch (err) {
      log.warn("teams send target failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(row.id, "Teams could not be reached, so nothing was sent. Try again.").catch(() => undefined);
      return;
    }
    if (!text.trim()) {
      await markFailed(row.id, "There is nothing to send.");
      return;
    }

    let sent: GraphChatMessage;
    try {
      sent = await postReply(this.need(), thread.provider_thread_id, text);
    } catch (err) {
      log.warn("teams reply failed", { account: this.id, outbox: row.id, code: errorCode(err) });
      await markFailed(row.id, sendFailure(err, true)).catch(() => undefined);
      return;
    }
    if (!(await settleSent(row.id, storedMessageId(thread.provider_thread_index, sent.id)))) log.warn("teams reply sent but not recorded", { account: this.id, outbox: row.id });
    else log.info("teams reply sent", { account: this.id, outbox: row.id });

    // Show it in the conversation now rather than at the next check. Graph answers with the message as posted.
    const chat: GraphChat = { id: thread.provider_thread_id, chatType: thread.is_group ? "group" : "oneOnOne", topic: thread.group_name };
    const posted: GraphChatMessage = { ...sent, from: sent.from?.user ? sent.from : { user: { id: this.me.userId } }, createdDateTime: sent.createdDateTime ?? new Date().toISOString() };
    await this.queue
      .run(async () => {
        const payload = await this.payload(chat, thread.provider_thread_index, this.members.get(chat.id)?.members ?? new Map(), posted, false);
        if (payload) await ingestTeams(this.id, payload);
      })
      .catch((err) => log.warn("store sent teams failed", { account: this.id, outbox: row.id, code: errorCode(err) }));
  }

  /**
   * A 'read' action means you opened the chat in the app; only then does Teams hear you read it. Archive and
   * the rest are app-only here, and reactions cannot be sent to Teams yet.
   */
  async applyAction(row: Tables<"mail_actions">) {
    if (!this.ready) return; // still connecting: the next poll retries it
    try {
      if (row.action === "react") {
        await finishAction(row.id, "Reactions cannot be sent to Teams from here yet.");
        return;
      }
      if (row.action === "read") {
        const thread = must(
          await db.from("threads").select("provider_thread_id").eq("id", row.thread_id).eq("account_id", this.id).maybeSingle(),
          "load teams thread",
        );
        await openAddresses(this.account.user_id, thread);
        if (!thread) throw Object.assign(new Error("no thread"), { code: "NO_THREAD" });
        await markChatRead(this.need(), thread.provider_thread_id, { userId: this.me.userId, tenantId: await this.tenantFor(thread.provider_thread_id) });
        log.info("teams chat marked read", { account: this.id, action: row.id });
      }
      await finishAction(row.id);
    } catch (err) {
      log.warn("teams action failed", { account: this.id, action: row.action, code: errorCode(err) });
      await finishAction(row.id, row.action === "read" ? "Could not tell Teams you read this chat." : "Could not update Teams.");
    }
  }

  /** Your organisation's ID, which Teams wants when marking a chat read: from the chat's members, else Graph. */
  private async tenantFor(chatId: string): Promise<string> {
    const fromChat = this.members.get(chatId)?.members.get(this.me.userId)?.tenantId;
    if (fromChat) return fromChat;
    if (!this.tenantId) {
      const page = await this.need().request<{ value?: { id?: string }[] }>("/organization", { query: { $select: "id" } });
      this.tenantId = page.value?.[0]?.id ?? null;
    }
    if (!this.tenantId) throw Object.assign(new Error("no tenant"), { code: "NO_TENANT" });
    return this.tenantId;
  }

  // ---------------------------------------------------------------------------
  // Meetings and transcripts
  // ---------------------------------------------------------------------------

  private meetingsInBackground() {
    if (this.meetingsRunning) return;
    this.meetingsRunning = true;
    this.syncMeetings()
      .catch((err) => log.warn("teams meetings failed", { account: this.id, code: errorCode(err) }))
      .finally(() => {
        this.meetingsRunning = false;
      });
  }

  /** Finds Teams meetings that have started on your calendar, then looks for the transcripts still missing. */
  private async syncMeetings() {
    const client = this.need();
    const now = Date.now();
    const last = Date.parse((await getSyncState(this.id, "meetings"))?.sync_token ?? "");
    const from = Number.isFinite(last) ? Math.max(last - MEETINGS_OVERLAP_MS, now - FIRST_MEETINGS_MS) : now - FIRST_MEETINGS_MS;

    const events: MeetingEvent[] = [];
    let url: string | undefined = "/me/calendarView";
    let query: GraphRequest["query"] = { startDateTime: new Date(from).toISOString(), endDateTime: new Date(now).toISOString(), $select: EVENT_SELECT };
    while (url && !this.stopped) {
      const page: { value?: MeetingEvent[]; "@odata.nextLink"?: string } = await client.request(url, {
        query,
        prefer: ['outlook.timezone="UTC"', "odata.maxpagesize=100"],
      });
      events.push(...(page.value ?? []));
      url = page["@odata.nextLink"];
      query = undefined;
    }
    const found = teamsMeetings(events, now, { name: this.me.name, addresses: this.selfAddresses });

    const known = new Set<string>();
    for (const ids of chunks(found.map((m) => m.eventId), 100)) {
      const rows = must(await db.from("meetings").select("provider_meeting_id").eq("account_id", this.id).in("provider_meeting_id", ids), "load teams meetings");
      for (const r of rows) known.add(r.provider_meeting_id);
    }
    let added = 0;
    for (const meeting of found) {
      if (this.stopped) return;
      if (!known.has(meeting.eventId) && (await this.addMeeting(meeting))) added++;
    }

    const waiting = must(
      await db.from("meetings").select("id, started_at, ended_at, provider_meta").eq("account_id", this.id).eq("status", "waiting").order("started_at").limit(100),
      "load waiting meetings",
    );
    for (const row of waiting) {
      if (this.stopped) return;
      try {
        await this.checkTranscript(row, now);
      } catch (err) {
        log.warn("teams transcript check failed", { account: this.id, meeting: row.id, code: errorCode(err) });
      }
    }
    await saveSyncState(this.id, "meetings", { sync_token: new Date(now).toISOString() });
    if (added > 0) log.info("teams meetings found", { account: this.id, added, waiting: waiting.length });
  }

  /**
   * Stores a meeting as waiting for its transcript, with who was invited, once its online meeting is found.
   * One that cannot be found is stored as having no transcript, with why. Returns whether it was new.
   */
  private async addMeeting(meeting: ReturnType<typeof teamsMeetings>[number]): Promise<boolean> {
    let onlineMeetingId: string | null = null;
    let problem: string | null = null;
    try {
      const page = await this.need().request<{ value?: { id?: string }[] }>("/me/onlineMeetings", { query: { $filter: joinUrlFilter(meeting.joinUrl) } });
      onlineMeetingId = page.value?.[0]?.id ?? null;
      if (!onlineMeetingId) problem = NOT_FOUND;
    } catch (err) {
      if (!(err instanceof GraphApiError && [400, 403, 404].includes(err.status))) throw err;
      problem = err.status === 403 ? NOT_SHARED : NOT_FOUND;
    }
    const user = this.account.user_id;
    const meta: TeamsMeetingMeta = { join_url: meeting.joinUrl, online_meeting_id: onlineMeetingId, event_id: meeting.eventId, ical_uid: meeting.icalUid };
    const created = must(
      await db
        .from("meetings")
        .upsert(
          {
            user_id: user,
            account_id: this.id,
            platform: "teams",
            // The calendar event's ID: a repeating meeting has one online meeting for every occurrence.
            provider_meeting_id: meeting.eventId,
            title: await seal(user, FIELD.meetingTitle, meeting.title),
            started_at: new Date(meeting.startedAt).toISOString(),
            ended_at: new Date(meeting.endedAt).toISOString(),
            status: problem ? "no_transcript" : "waiting",
            error: problem,
            provider_meta: meta,
          },
          { onConflict: "account_id,provider_meeting_id", ignoreDuplicates: true },
        )
        .select("id"),
      "save teams meeting",
    );
    const id = created[0]?.id;
    if (!id) return false;
    await this.addParticipants(id, meeting.people);
    return true;
  }

  private async addParticipants(meetingId: string, people: MeetingPerson[]) {
    if (people.length === 0) return;
    const user = this.account.user_id;
    const rows = await Promise.all(
      people.map(async (p) => ({ meeting_id: meetingId, user_id: user, name: await seal(user, FIELD.name, p.name), address: await sealAddress(user, p.email), is_self: p.self })),
    );
    must(await db.from("meeting_participants").insert(rows), "save meeting participants");
  }

  /**
   * Looks for a finished meeting's transcripts and stores them as one, with any speaker who was not invited
   * added to its people. Gives up, as no transcript, a few hours after the meeting.
   */
  private async checkTranscript(row: WaitingMeeting, now: number) {
    const startedAt = Date.parse(row.started_at);
    const endedAt = Date.parse(row.ended_at ?? row.started_at);
    if (!transcriptCheckDue(endedAt, now, this.checkedAt.get(row.id))) return;
    this.checkedAt.set(row.id, now);
    const meta = (row.provider_meta ?? {}) as TeamsMeetingMeta;
    if (!meta.online_meeting_id) {
      await this.settleMeeting(row.id, { status: "no_transcript", error: NOT_FOUND });
      return;
    }

    const client = this.need();
    const base = `/me/onlineMeetings/${encodeURIComponent(meta.online_meeting_id)}/transcripts`;
    let list: CallTranscript[];
    try {
      list = (await client.request<{ value?: CallTranscript[] }>(base)).value ?? [];
    } catch (err) {
      if (!(err instanceof GraphApiError && (err.status === 403 || err.status === 404))) throw err;
      await this.settleMeeting(row.id, { status: "no_transcript", error: NOT_SHARED });
      return;
    }
    const { transcripts, finished } = transcriptsFor(list, { startedAt, endedAt });
    const later = async () => {
      if (gaveUp(endedAt, now)) await this.settleMeeting(row.id, { status: "no_transcript", error: null });
    };
    if (transcripts.length === 0 || !finished) return later();

    const parts: Parameters<typeof joinTranscripts>[0] = [];
    for (const t of transcripts) {
      let vtt: string;
      try {
        vtt = (await client.bytes(`${base}/${encodeURIComponent(t.id)}/content`, { query: { $format: "text/vtt" }, timeoutMs: 120_000 })).toString("utf8");
      } catch (err) {
        if (err instanceof GraphApiError && err.status === 404) return later(); // listed before its content is ready
        throw err;
      }
      parts.push({ startedAt: Date.parse(t.createdDateTime!), segments: parseVtt(vtt) });
    }
    const segments = joinTranscripts(parts);
    if (segments.length === 0) return later();

    // A guest who joined by link spoke without being invited: added by name, with no address.
    const user = this.account.user_id;
    const people = must(await db.from("meeting_participants").select("name").eq("meeting_id", row.id), "load meeting participants");
    const names = await Promise.all(people.map((p) => open(user, FIELD.name, p.name)));
    const extra = newSpeakers(segments, names);
    if (extra.length) await this.addParticipants(row.id, extra.map((name) => ({ name, email: null, self: false })));

    await this.settleMeeting(row.id, {
      status: "transcribed",
      transcript_source: "provider",
      transcript: await seal(user, FIELD.transcript, JSON.stringify(segments)),
      error: null,
      provider_meta: { ...meta, transcript_ids: transcripts.map((t) => t.id) },
    });
    log.info("teams transcript saved", { account: this.id, meeting: row.id, segments: segments.length });
  }

  /** Finishes a waiting meeting. One something else has moved on already is left alone. */
  private async settleMeeting(id: string, patch: TablesUpdate<"meetings">) {
    must(await db.from("meetings").update(patch).eq("id", id).eq("status", "waiting"), "save teams meeting");
    this.checkedAt.delete(id);
  }

  private need(): GraphClient {
    if (!this.client) throw Object.assign(new Error("not connected"), { code: "NOT_CONNECTED" });
    return this.client;
  }
}
