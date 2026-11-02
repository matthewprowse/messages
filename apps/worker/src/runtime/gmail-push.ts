// Pulls Gmail's Pub/Sub notifications and wakes the connector each one is for. One loop per worker process, started the
// first time a Gmail connector asks for it (gmailPush()), and only when GMAIL_PUBSUB_TOPIC and GMAIL_PUBSUB_SUBSCRIPTION
// are set; with them unset gmailPush() is null and the connectors keep to their slow poll.
//
// Several workers (shards) can share one subscription. A message for a mailbox another shard owns is released
// back at once so that shard's pull gets it; with one worker an unknown mailbox (a removed account) is just acknowledged.

import { googleAccessToken } from "@messages/crypto/wrap";
import { Backoff, sleep } from "../backoff";
import { PushRouter, parseGmailNotification } from "../google/gmail-push";
import { PubSubPull, type PubSubMessage } from "../google/pubsub";
import { errorCode, log } from "../log";
import { shardCount } from "../shard";

/** What to do with each message of a pull: acknowledge it, or give it back for another worker. */
export function sortBatch(messages: PubSubMessage[], router: PushRouter, sharded: boolean): { ack: string[]; release: string[] } {
  const ack: string[] = [];
  const release: string[] = [];
  for (const m of messages) {
    const note = parseGmailNotification(m.data);
    if (!note) { ack.push(m.ackId); continue; } // not ours to understand: do not let it come back
    const woken = router.route(note);
    if (woken === 0 && sharded) release.push(m.ackId);
    else ack.push(m.ackId);
  }
  return { ack, release };
}

/** One pull, sorted, acknowledged and released. Returns whether anything was released (the loop pauses briefly if so). */
export async function pumpOnce(puller: Pick<PubSubPull, "pull" | "ack" | "release">, router: PushRouter, sharded: boolean): Promise<boolean> {
  const messages = await puller.pull();
  if (messages.length === 0) return false;
  const { ack, release } = sortBatch(messages, router, sharded);
  await puller.ack(ack);
  await puller.release(release);
  return release.length > 0;
}

export interface GmailPush {
  router: PushRouter;
  /** The topic users.watch publishes to. */
  topic: string;
}

let started: GmailPush | null | undefined;

/** The shared router and topic, starting the pull loop on first use. Null when Pub/Sub is not configured. */
export function gmailPush(): GmailPush | null {
  if (started !== undefined) return started;
  const topic = process.env.GMAIL_PUBSUB_TOPIC?.trim();
  const subscription = process.env.GMAIL_PUBSUB_SUBSCRIPTION?.trim();
  if (!topic || !subscription) return (started = null);
  const router = new PushRouter();
  const puller = new PubSubPull(subscription, googleAccessToken());
  const backoff = new Backoff(2_000, 2 * 60_000);
  void (async () => {
    for (;;) {
      try {
        const released = await pumpOnce(puller, router, shardCount > 1);
        backoff.reset();
        if (released) await sleep(1_000);
      } catch (err) {
        // The slow poll covers a pull that is down; this only logs and retries with a growing pause.
        log.warn("gmail pubsub pull failed", { code: errorCode(err) });
        await sleep(backoff.next());
      }
    }
  })();
  return (started = { router, topic });
}
