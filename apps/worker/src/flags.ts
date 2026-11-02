// Feature flags and kill switches (the feature_flags table, edited by the owner in Admin). Pure: the rows come in through a
// loader, so it is tested without a database. flags-db.ts binds the one the worker uses.
//
// A flag that is `enabled` is a switch thrown (pause this, disable that). An empty user list means everyone; a list limits
// it to those people, and a check made with no person in mind (a whole connector kind) is not hit by a per-person switch.
// The rows are cached for a few seconds so a hot path (every outbox claim) costs no query. If they cannot be read the last
// good rows stay in force, and before any read succeeds every switch is off: a missing table must never stop the product.

export interface FlagRow {
  key: string;
  enabled: boolean;
  user_ids: string[] | null;
}

/** How long a read of the flags is trusted. Short, so a switch thrown in Admin bites within seconds. */
export const FLAG_CACHE_MS = 15_000;

/** Whether the switch `key` is thrown for `userId` (or for everyone when no person is given). */
export function flagIsOn(rows: ReadonlyMap<string, FlagRow>, key: string, userId?: string): boolean {
  const row = rows.get(key);
  if (!row?.enabled) return false;
  const people = row.user_ids ?? [];
  if (people.length === 0) return true;
  return userId !== undefined && people.includes(userId);
}

export interface FlagsOptions {
  ttlMs?: number;
  now?: () => number;
  /** Called with a short code when a read fails (never the message). */
  onError?: (code: string) => void;
}

export class Flags {
  private rows = new Map<string, FlagRow>();
  private readAt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | null = null;
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(private readonly load: () => Promise<FlagRow[]>, private readonly opts: FlagsOptions = {}) {
    this.ttl = opts.ttlMs ?? FLAG_CACHE_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Reads the flags again when the cached ones are older than the cache time. Never throws. Calls made while a read runs share it. */
  refresh(): Promise<void> {
    if (this.now() - this.readAt < this.ttl) return Promise.resolve();
    this.inflight ??= this.read().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async read(): Promise<void> {
    try {
      const rows = await this.load();
      this.rows = new Map(rows.map((r) => [r.key, r]));
    } catch (err) {
      this.opts.onError?.((err as { code?: string })?.code ?? "FLAGS_READ_FAILED");
    }
    // Stamped on failure too, so a broken table is asked again after the cache time, not on every call.
    this.readAt = this.now();
  }

  /** The switch from the cache, without waiting. Use after `refresh()` in a loop that checks many accounts. */
  isOn(key: string, userId?: string): boolean {
    return flagIsOn(this.rows, key, userId);
  }

  /** Refreshes if stale, then answers. */
  async on(key: string, userId?: string): Promise<boolean> {
    await this.refresh();
    return this.isOn(key, userId);
  }
}

/** The switch that stops a provider's connectors, from an account's provider name. */
export const connectorFlag = (provider: string): string => `disable_connector_${provider}`;

/** Whether a provider's connectors are switched off for this person. Read from the cache: call `refresh()` first. */
export const connectorBlocked = (f: Pick<Flags, "isOn">, provider: string, userId: string): boolean => f.isOn(connectorFlag(provider), userId);

/** The switch that holds every queued send. */
export const SENDS_FLAG = "disable_sends";
