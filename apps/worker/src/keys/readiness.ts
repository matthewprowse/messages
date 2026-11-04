// Whether the two static keys can be removed (docs/RUNBOOK.md, Rotating And Releasing Keys): the counts the readiness
// script (scripts/keys-readiness.ts) reads, and what they mean. Pure, so the verdict is tested without a database.
//   KEY_WRAPPING_KEY  can go when no key in user_keys or team_keys (any slot: current, next, previous, index) is local:v1.
//   ENCRYPTION_KEY    can go when no sign-in, session or handoff is still "v1:".

/** One thing counted: which table and column, which key it needs, and how many rows still need it. */
export interface ReadinessCount {
  what: string;
  needs: "KEY_WRAPPING_KEY" | "ENCRYPTION_KEY";
  count: number;
  /** How to clear it. */
  fix: string;
}

/** The counts the script reads: label, which key, the table, the column, the match, and the fix. */
export const CHECKS = [
  { needs: "KEY_WRAPPING_KEY", table: "user_keys", column: "wrapped_by", match: "eq", value: "local:v1", fix: "pnpm --filter worker rewrap-keys --apply" },
  { needs: "KEY_WRAPPING_KEY", table: "user_keys", column: "next_wrapped_by", match: "eq", value: "local:v1", fix: "finish the rotation (keys:rekey), then rewrap-keys" },
  { needs: "KEY_WRAPPING_KEY", table: "user_keys", column: "previous_wrapped_by", match: "eq", value: "local:v1", fix: "finish the rotation (keys:rekey --apply)" },
  { needs: "KEY_WRAPPING_KEY", table: "user_keys", column: "index_wrapped_by", match: "eq", value: "local:v1", fix: "pnpm --filter worker rewrap-keys --apply" },
  { needs: "KEY_WRAPPING_KEY", table: "team_keys", column: "wrapped_by", match: "eq", value: "local:v1", fix: "pnpm --filter worker rewrap-keys --apply" },
  { needs: "ENCRYPTION_KEY", table: "account_credentials", column: "ciphertext", match: "like", value: "v1:%", fix: "pnpm --filter worker credentials:reseal --apply" },
  { needs: "ENCRYPTION_KEY", table: "account_credentials", column: "refreshed", match: "like", value: "v1:%", fix: "pnpm --filter worker credentials:reseal --apply" },
  { needs: "ENCRYPTION_KEY", table: "whatsapp_auth_keys", column: "ciphertext", match: "like", value: "v1:%", fix: "pnpm --filter worker credentials:reseal --apply" },
  { needs: "ENCRYPTION_KEY", table: "icloud_setups", column: "sign_in", match: "like", value: "v1:%", fix: "wait: setups are deleted within an hour" },
  { needs: "ENCRYPTION_KEY", table: "icloud_setups", column: "result", match: "like", value: "v1:%", fix: "wait: setups are deleted within an hour" },
  { needs: "ENCRYPTION_KEY", table: "icloud_setups", column: "code", match: "like", value: "v1:%", fix: "wait: setups are deleted within an hour" },
  { needs: "ENCRYPTION_KEY", table: "instagram_sign_ins", column: "code", match: "like", value: "v1:%", fix: "wait: a code is taken within seconds and cleared within minutes" },
] as const;

export interface Verdict {
  /** Each static key, and whether nothing stored needs it any more. */
  ready: Record<ReadinessCount["needs"], boolean>;
  /** The counts that are not zero, the reason a key must stay. */
  blocking: ReadinessCount[];
}

/** Which static keys can be removed, from the counts. A count that could not be read (null) blocks its key. */
export function readinessVerdict(counts: (ReadinessCount | (Omit<ReadinessCount, "count"> & { count: null }))[]): Verdict {
  const blocking = counts.filter((c) => c.count !== 0) as ReadinessCount[];
  return {
    ready: {
      KEY_WRAPPING_KEY: !blocking.some((c) => c.needs === "KEY_WRAPPING_KEY"),
      ENCRYPTION_KEY: !blocking.some((c) => c.needs === "ENCRYPTION_KEY"),
    },
    blocking,
  };
}
