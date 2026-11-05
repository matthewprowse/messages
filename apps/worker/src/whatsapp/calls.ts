// Calls. WhatsApp tells a linked device about a call in two ways, and neither is a message, so calls would vanish:
// - a live event while a call to you rings; a call that rang out unanswered is turned into a missed call line;
// - a call log record in app state sync once a call is over, for calls you made from your phone as well as calls to you,
//   with how it ended and how long it lasted. Baileys drops these, so the connector catches them through its logger
//   (logger.ts) and they are turned into call lines here.
// Both become the same call log message WhatsApp keeps in a chat, which the normal pipeline then stores (normalize.ts reads
// it as "Missed Voice Call", "Voice Call" and so on). The message id comes from the call's, so the same call is stored once,
// whichever way it arrives first. Pure: the connector passes the event or record in.

import { jidNormalizedUser, proto, type WACallEvent, type WAMessage } from "baileys";
import { CALL_DECLINED, CALL_MISSED } from "./normalize";

/**
 * The call log message for a call that rang out unanswered, or null for anything else: a call you made, a call someone picked up
 * or declined, and every step of a call on its way. `fromMe` is whether you were the one calling.
 */
export function missedCallMessage(ev: Pick<WACallEvent, "chatId" | "from" | "id" | "date" | "isVideo" | "isGroup" | "status">, fromMe: boolean): WAMessage | null {
  if (ev.status !== "timeout" || fromMe || !ev.id || !ev.chatId) return null;
  return {
    key: { remoteJid: ev.chatId, fromMe: false, id: `call-${ev.id}`, ...(ev.isGroup ? { participant: ev.from } : {}) },
    messageTimestamp: Math.floor(ev.date.getTime() / 1000),
    message: { callLogMesssage: { isVideo: !!ev.isVideo, callOutcome: CALL_MISSED } },
  };
}

const Result = proto.CallLogRecord.CallResult;
/** Results that are not a finished call: one still going or not started yet would be stored before it has an outcome. */
const UNFINISHED = new Set([Result.ONGOING, Result.UPCOMING, Result.INVALID]);

/** The value app state sync hands its logger with each change: `logger.trace({ syncAction }, "processing sync action")`. */
export function callLogRecordOf(traced: unknown): proto.ICallLogRecord | null {
  const value = (traced as { syncAction?: { syncAction?: { value?: proto.ISyncActionValue } } } | null)?.syncAction?.syncAction?.value;
  return value?.callLogAction?.callLogRecord ?? null;
}

/** A Long, number or null as a plain number. */
const num = (v: number | { toNumber(): number } | null | undefined) => (v == null ? 0 : typeof v === "number" ? v : v.toNumber());

/**
 * The call log message for a finished call from app state sync, or null when it cannot be placed in one chat: a call link, a
 * group call outside a group, a call still going. `mine` holds your own JIDs (phone number and privacy ID), normalized.
 * A call to you that you did not pick up is missed; one you made that nobody picked up is stored as missed too and shown as
 * "No Answer", since it went out from you.
 */
export function callLogMessage(r: proto.ICallLogRecord, mine: Set<string>): WAMessage | null {
  if (!r.callId || r.isCallLink || r.callResult == null || UNFINISHED.has(r.callResult)) return null;
  const incoming = !!r.isIncoming;
  const creator = r.callCreatorJid ? jidNormalizedUser(r.callCreatorJid) : null;
  const others = (r.participants ?? []).map((p) => (p.userJid ? jidNormalizedUser(p.userJid) : "")).filter((j) => j && !mine.has(j));
  let remoteJid: string | null;
  let participant: string | undefined;
  if (r.groupJid) {
    remoteJid = r.groupJid;
    if (incoming && creator) participant = creator;
  } else if (incoming) {
    remoteJid = creator && !mine.has(creator) ? creator : (others[0] ?? null);
  } else {
    if (others.length > 1) return null; // a group call started outside a group has no one chat to sit in
    remoteJid = others[0] ?? (creator && !mine.has(creator) ? creator : null);
  }
  const start = num(r.startTime);
  if (!remoteJid || !start) return null;

  const answered = r.callResult === Result.CONNECTED || (incoming && r.callResult === Result.ACCEPTEDELSEWHERE);
  const outcome = answered ? 0 : incoming && r.callResult === Result.REJECTED ? CALL_DECLINED : CALL_MISSED;
  const seconds = answered ? num(r.duration) : 0;
  return {
    key: { remoteJid, fromMe: !incoming, id: `call-${r.callId}`, ...(participant ? { participant } : {}) },
    // WhatsApp gives the start in milliseconds in some versions and seconds in others; a value past the year 2286 is milliseconds.
    messageTimestamp: start > 1e10 ? Math.floor(start / 1000) : start,
    message: { callLogMesssage: { isVideo: !!r.isVideo, callOutcome: outcome, ...(seconds > 0 ? { durationSecs: seconds } : {}) } },
  };
}
