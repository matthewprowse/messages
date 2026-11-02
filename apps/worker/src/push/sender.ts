// The push sender: every 20 seconds it looks for conversations with a new Urgent or Important message from the last half
// hour, belonging to people who have a subscribed device, and pushes a content-free notice (payload.ts). I/O only; the
// decisions live in plan.ts and policy.ts. Runs on the primary shard because it reads across all users.
//
// A thread is claimed by writing its last_message_at into threads.push_notified_at with a compare-and-swap, so a
// message is pushed once even if two workers overlap. Expired subscriptions (404 or 410) are deleted.

import webpush from "web-push";
import type { Tables } from "@messages/db";
import { db } from "../db";
import { errorCode, log } from "../log";
import { readVapid } from "./config";
import { deliver } from "./deliver";
import { buildPayload } from "./payload";
import { planPushes, type Candidate } from "./plan";
import { FRESH_MS, type PushSettings } from "./policy";
import { PushRateLimit } from "./rate-limit";

const POLL_MS = 20_000;
const MAX_THREADS = 200; // per pass; the rest wait for the next one

type ThreadRow = Pick<Tables<"threads">, "id" | "user_id" | "priority" | "last_from_me" | "unread_count" | "status" | "junk" | "last_message_at" | "push_notified_at">;

function toCandidate(r: ThreadRow): Candidate {
  return { id: r.id, userId: r.user_id, priority: r.priority, lastFromMe: r.last_from_me, unreadCount: r.unread_count, status: r.status, junk: r.junk, lastMessageAt: r.last_message_at, pushNotifiedAt: r.push_notified_at };
}

/** Marks a thread's newest message as looked at. False when someone else already did (nothing is sent then). */
async function claim(t: Candidate): Promise<boolean> {
  const q = db.from("threads").update({ push_notified_at: t.lastMessageAt }).eq("id", t.id).eq("user_id", t.userId);
  const { data, error } = await (t.pushNotifiedAt ? q.eq("push_notified_at", t.pushNotifiedAt) : q.is("push_notified_at", null)).select("id");
  if (error) throw new Error("claim thread failed");
  return (data?.length ?? 0) > 0;
}

/** One pass: returns how many pushes were sent. Exported for nothing but the interval below. */
async function pass(limit: PushRateLimit, send: Parameters<typeof deliver>[3]): Promise<number> {
  const subsRes = await db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
  if (subsRes.error) throw new Error("read subscriptions failed");
  const subsByUser = new Map<string, NonNullable<typeof subsRes.data>>();
  for (const s of subsRes.data) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);
  if (!subsByUser.size) return 0;
  const users = [...subsByUser.keys()];

  const since = new Date(Date.now() - FRESH_MS).toISOString();
  const th = await db.from("threads")
    .select("id, user_id, priority, last_from_me, unread_count, status, junk, last_message_at, push_notified_at")
    .in("user_id", users).in("priority", ["urgent", "important"]).eq("status", "inbox").eq("junk", false).eq("last_from_me", false)
    .gt("unread_count", 0).gte("last_message_at", since).order("last_message_at", { ascending: false }).limit(MAX_THREADS);
  if (th.error) throw new Error("read threads failed");
  if (!th.data.length) return 0;

  const prof = await db.from("profiles").select("user_id, push_urgent, push_important, quiet_start, quiet_end, timezone").in("user_id", [...new Set(th.data.map((r) => r.user_id))]);
  if (prof.error) throw new Error("read profiles failed");
  const settings = new Map<string, PushSettings>(prof.data.map((p) => [p.user_id, { pushUrgent: p.push_urgent, pushImportant: p.push_important, quietStart: p.quiet_start, quietEnd: p.quiet_end, timezone: p.timezone }]));

  const plan = planPushes(th.data.map(toCandidate), settings, new Date());
  for (const t of plan.settle) await claim(t);

  let sent = 0;
  for (const { thread, kind } of plan.send) {
    // Over the limit: leave it unclaimed, so it goes out later if it is still fresh.
    if (!limit.take(thread.userId)) continue;
    if (!(await claim(thread))) continue;
    const res = await deliver(subsByUser.get(thread.userId) ?? [], buildPayload(kind, thread.id), kind, send);
    sent += res.sent;
    if (res.expired.length) {
      const del = await db.from("push_subscriptions").delete().in("id", res.expired).eq("user_id", thread.userId);
      if (del.error) log.warn("delete expired push subscriptions failed", { code: del.error.code });
      else log.info("expired push subscriptions removed", { count: res.expired.length });
    }
    if (res.failed) log.warn("push delivery failed", { count: res.failed });
  }
  return sent;
}

/** Starts the sender. Does nothing (and says why, once) while the VAPID keys are not set. */
export function startPushSender() {
  const vapid = readVapid(process.env);
  if (!vapid) { log.info("web push is off: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to turn it on"); return; }
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const limit = new PushRateLimit();
  const send: Parameters<typeof deliver>[3] = (sub, body, options) => webpush.sendNotification(sub, body, options);
  let running = false;
  const tick = () => {
    if (running) return; // a slow pass must not overlap the next
    running = true;
    pass(limit, send).catch((err) => log.error("push pass failed", { code: errorCode(err) })).finally(() => { running = false; });
  };
  setInterval(tick, POLL_MS).unref();
  log.info("web push sender started");
}
