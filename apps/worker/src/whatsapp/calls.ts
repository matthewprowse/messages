// Missed calls. WhatsApp tells a linked device about a call as an event, not as a message, so a call nobody picked up would
// vanish. A call that rang out is turned here into the same call log message WhatsApp keeps in a chat, which the normal
// pipeline then stores (normalize.ts reads it as "Missed Voice Call"). Pure: the connector passes the event in.

import type { WACallEvent, WAMessage } from "baileys";
import { CALL_MISSED } from "./normalize";

/**
 * The call log message for a call that rang out unanswered, or null for anything else: a call you made, a call someone picked up
 * or declined, and every step of a call on its way. The message id comes from the call's, so a repeated event is stored once.
 * `fromMe` is whether you were the one calling.
 */
export function missedCallMessage(ev: Pick<WACallEvent, "chatId" | "from" | "id" | "date" | "isVideo" | "isGroup" | "status">, fromMe: boolean): WAMessage | null {
  if (ev.status !== "timeout" || fromMe || !ev.id || !ev.chatId) return null;
  return {
    key: { remoteJid: ev.chatId, fromMe: false, id: `call-${ev.id}`, ...(ev.isGroup ? { participant: ev.from } : {}) },
    messageTimestamp: Math.floor(ev.date.getTime() / 1000),
    message: { callLogMesssage: { isVideo: !!ev.isVideo, callOutcome: CALL_MISSED } },
  };
}
