// A minimal Cloud Pub/Sub pull client over REST, enough for Gmail push: pull, acknowledge, and release a message for
// another subscriber. Pull is outbound only, so it needs no public endpoint and works inside Confidential Space.
// Google's access token and fetch are passed in so tests use fakes and never reach Google.

const API = "https://pubsub.googleapis.com/v1";
/** A pull with nothing to deliver is held open by Pub/Sub for a while; stop waiting a little after that. */
const PULL_TIMEOUT_MS = 95_000;

export interface PubSubMessage {
  ackId: string;
  messageId: string;
  /** The base64 data field. */
  data: string | undefined;
}

export class PubSubError extends Error {
  readonly code: string;
  constructor(readonly status: number) {
    super(`pubsub request failed: ${status}`);
    this.code = `HTTP_${status}`;
  }
}

export class PubSubPull {
  constructor(
    /** projects/<project>/subscriptions/<name> */
    private readonly subscription: string,
    private readonly token: () => Promise<string>,
    private readonly doFetch: typeof fetch = globalThis.fetch,
    private readonly timeoutMs = PULL_TIMEOUT_MS,
  ) {}

  private async call<T>(verb: string, body: unknown): Promise<T> {
    const res = await this.doFetch(`${API}/${this.subscription}:${verb}`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new PubSubError(res.status);
    return (await res.json().catch(() => ({}))) as T;
  }

  /** Waits for up to `max` messages. An empty list means the wait ended quietly. */
  async pull(max = 50): Promise<PubSubMessage[]> {
    const out = await this.call<{ receivedMessages?: { ackId: string; message?: { messageId?: string; data?: string } }[] }>("pull", { maxMessages: max });
    return (out.receivedMessages ?? []).map((m) => ({ ackId: m.ackId, messageId: m.message?.messageId ?? "", data: m.message?.data }));
  }

  async ack(ackIds: string[]): Promise<void> {
    if (ackIds.length > 0) await this.call("acknowledge", { ackIds });
  }

  /** Gives messages back at once, so another worker's pull gets them. */
  async release(ackIds: string[]): Promise<void> {
    if (ackIds.length > 0) await this.call("modifyAckDeadline", { ackIds, ackDeadlineSeconds: 0 });
  }
}
