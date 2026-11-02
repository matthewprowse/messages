// The safety rails on WhatsApp sending, as plain numbers and pure decisions: how long to leave between messages, how long to
// show "typing", and whether a daily limit has been reached. WhatsApp bans linked devices that send like a script, so every
// send goes through these (whatsapp/send.ts). No clock, no random and no database here: they are passed in, so tests are exact.

/** The tunable limits. Read from the worker's environment by railsFromEnv; the defaults are deliberately cautious. */
export interface Rails {
  /** Least wait between one message ending and the next starting on the same account, ms, plus up to gapJitterMs. */
  minGapMs: number;
  gapJitterMs: number;
  /** Wait between the parts of one message (a caption and its files), ms, plus up to partJitterMs. */
  partGapMs: number;
  partJitterMs: number;
  /** "Typing" shows for this long per character of text, kept between typingMinMs and typingMaxMs. */
  typingMsPerChar: number;
  typingMinMs: number;
  typingMaxMs: number;
  /** Messages an account may send in any 24 hours, and the part of those to people it has never chatted with. */
  dailyCap: number;
  newChatCap: number;
}

export const DEFAULT_RAILS: Rails = {
  minGapMs: 6_000,
  gapJitterMs: 6_000,
  partGapMs: 2_000,
  partJitterMs: 2_000,
  typingMsPerChar: 45,
  typingMinMs: 1_200,
  typingMaxMs: 8_000,
  dailyCap: 300,
  newChatCap: 20,
};

const DAY_MS = 24 * 60 * 60_000;

/** A whole number from the environment: the fallback when it is missing, not a number or below `min`. */
function whole(value: string | undefined, fallback: number, min: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

/**
 * The rails from WHATSAPP_MIN_GAP_SECONDS, WHATSAPP_GAP_JITTER_SECONDS, WHATSAPP_PART_GAP_SECONDS, WHATSAPP_TYPING_MAX_SECONDS,
 * WHATSAPP_DAILY_CAP and WHATSAPP_NEW_CHAT_CAP. A cap below 1 is ignored (the default stays), so a typo cannot switch the
 * safety off; the gaps may be 0 for a test account.
 */
export function railsFromEnv(e: Record<string, string | undefined>): Rails {
  const d = DEFAULT_RAILS;
  return {
    ...d,
    minGapMs: whole(e.WHATSAPP_MIN_GAP_SECONDS, d.minGapMs / 1000, 0) * 1000,
    gapJitterMs: whole(e.WHATSAPP_GAP_JITTER_SECONDS, d.gapJitterMs / 1000, 0) * 1000,
    partGapMs: whole(e.WHATSAPP_PART_GAP_SECONDS, d.partGapMs / 1000, 0) * 1000,
    typingMaxMs: whole(e.WHATSAPP_TYPING_MAX_SECONDS, d.typingMaxMs / 1000, 1) * 1000,
    dailyCap: whole(e.WHATSAPP_DAILY_CAP, d.dailyCap, 1),
    newChatCap: whole(e.WHATSAPP_NEW_CHAT_CAP, d.newChatCap, 1),
  };
}

/** The wait before the next message may start: the minimum plus a random share of the jitter. `random` is in [0, 1). */
export function nextGapMs(r: Rails, random: number): number {
  return r.minGapMs + Math.floor(random * r.gapJitterMs);
}

/** The wait between two parts of one message. */
export function partGapMs(r: Rails, random: number): number {
  return r.partGapMs + Math.floor(random * r.partJitterMs);
}

/**
 * How long to show "typing" for text of this length: a person types about 45 ms a character, with a little give either way.
 * No text (a file on its own) shows nothing: 0.
 */
export function typingMs(r: Rails, textLength: number, random: number): number {
  if (textLength <= 0) return 0;
  const raw = textLength * r.typingMsPerChar * (0.85 + random * 0.3);
  return Math.floor(Math.min(r.typingMaxMs, Math.max(r.typingMinMs, raw)));
}

/** Why a message has to wait: the account's daily total, or its limit for people it has never chatted with. */
export type WaitReason = "daily_limit" | "new_chat_limit";

export type LimitVerdict = { ok: true } | { ok: false; reason: WaitReason; retryAt: number };

/** A send already counted: when it started (ms), and whether it went to someone the account had never chatted with. */
export interface RecentSend {
  at: number;
  cold: boolean;
}

/**
 * Whether one more message may go now. The window rolls: the cap lifts when enough of the oldest counted sends are 24 hours
 * old, and `retryAt` is that moment (ms), so a held message goes at the earliest time it safely can. When both limits bite, the
 * later moment wins and the reason is the daily one.
 */
export function checkLimits(recent: RecentSend[], cold: boolean, r: Rails, now: number): LimitVerdict {
  const inWindow = recent.filter((s) => s.at > now - DAY_MS);
  const liftAt = (times: number[], cap: number): number | null => {
    if (times.length < cap) return null;
    const sorted = [...times].sort((a, b) => a - b);
    return sorted[sorted.length - cap] + DAY_MS;
  };
  const daily = liftAt(inWindow.map((s) => s.at), r.dailyCap);
  const fresh = cold ? liftAt(inWindow.filter((s) => s.cold).map((s) => s.at), r.newChatCap) : null;
  if (daily === null && fresh === null) return { ok: true };
  return { ok: false, reason: daily !== null ? "daily_limit" : "new_chat_limit", retryAt: Math.max(daily ?? 0, fresh ?? 0) };
}

/** One account's pacing between messages. In memory: a restart only forgets the gap, never the daily count (that is in the database). */
export class Pacer {
  private nextAt = 0;
  constructor(
    private readonly rails: Rails,
    private readonly clock: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  /** Milliseconds to wait before the next message may start. */
  waitMs(): number {
    return Math.max(0, this.nextAt - this.clock());
  }

  /** A message has finished sending: the next one waits a fresh gap. */
  markSent() {
    this.nextAt = this.clock() + nextGapMs(this.rails, this.random());
  }

  partGap(): number {
    return partGapMs(this.rails, this.random());
  }

  typingFor(textLength: number): number {
    return typingMs(this.rails, textLength, this.random());
  }
}
