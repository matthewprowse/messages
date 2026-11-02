// Turns candidate threads and settings into the pushes to send, plus the threads settled without one (setting off,
// quiet hours). Pure: sender.ts reads the rows, calls this, then does the I/O.

import { allowedNow, isNewMessage, pushKind, type PushKind, type PushSettings, type PushThread } from "./policy";

export interface Candidate extends PushThread {
  id: string;
  userId: string;
}

export interface PushPlan {
  /** Threads to push now, with the kind of push. */
  send: { thread: Candidate; kind: PushKind }[];
  /** Threads with a new message that will not be pushed (the person's settings or quiet hours); marked looked at. */
  settle: Candidate[];
}

/** `settings` is keyed by user id; a thread whose person has none is settled unpushed. */
export function planPushes(candidates: Candidate[], settings: Map<string, PushSettings>, now: Date): PushPlan {
  const plan: PushPlan = { send: [], settle: [] };
  for (const t of candidates) {
    const kind = pushKind(t);
    if (!kind || !isNewMessage(t, now)) continue;
    const s = settings.get(t.userId);
    if (s && allowedNow(kind, s, now)) plan.send.push({ thread: t, kind });
    else plan.settle.push(t);
  }
  return plan;
}
