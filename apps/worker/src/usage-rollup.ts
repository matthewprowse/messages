import { db, must } from "./db";
import { startEvery } from "./backoff";
import { errorCode, log } from "./log";

/**
 * Once a day: AI usage rows older than 90 days are folded into ai_usage_monthly (per person, month, feature
 * and model) and deleted. The function is public.ai_usage_rollup() (supabase/migrations/20261102700000_*.sql).
 * Never throws; a missed day is made up the next.
 */
export function startUsageRollup(everyMs: number) {
  startEvery(
    10 * 60_000,
    everyMs,
    async () => {
      const rolled = must(await db.rpc("ai_usage_rollup" as never), "roll up ai usage") as unknown as number | null;
      if (rolled) log.info("ai usage rolled up", { rows: rolled });
    },
    (err) => log.warn("ai usage rollup failed", { code: errorCode(err) }),
  );
}
