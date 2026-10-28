import type { SupabaseClient } from "@supabase/supabase-js";
import { db, must } from "./db";
import { MissingFiles } from "./ingest/attachment-files";
import { fileRetryDelay } from "./polling";

// attachment_fetch_state is not in the generated types until they are regenerated after its migration.
const state = (db as unknown as SupabaseClient).from.bind(db as unknown as SupabaseClient, "attachment_fetch_state");

type Row = { id: string; message_id: string; provider_meta: unknown };

/**
 * MissingFiles with a limit on tries. A file that cannot be fetched is tried again after 10 minutes, then 20,
 * 40 and so on (FILE_FETCH_BASE_MS, doubling), and given up on after FILE_FETCH_MAX_TRIES tries
 * (attachment_fetch_state.gave_up), so a file the server will never return stops costing a fetch every scan.
 * The tries are kept in the database, so a restart does not start them over. A pass that finds nothing
 * due starts the next scan from the first page again.
 */
export class BackoffMissingFiles {
  private inner: MissingFiles;

  constructor(private readonly accountId: string, private readonly pageSize = 200) {
    this.inner = new MissingFiles(accountId, pageSize);
  }

  async next(): Promise<Row[]> {
    const rows = await this.inner.next();
    if (rows.length === 0) {
      this.inner = new MissingFiles(this.accountId, this.pageSize);
      return [];
    }
    const known = new Map<string, { tries: number; next_try_at: string; gave_up: boolean }>();
    const found = must(
      await state().select("attachment_id, tries, next_try_at, gave_up").in("attachment_id", rows.map((r) => r.id)),
      "load file fetch state",
    ) as { attachment_id: string; tries: number; next_try_at: string; gave_up: boolean }[];
    for (const f of found) known.set(f.attachment_id, f);

    const now = Date.now();
    const due = rows.filter((r) => {
      const s = known.get(r.id);
      return !s || (!s.gave_up && Date.parse(s.next_try_at) <= now);
    });
    if (due.length > 0) {
      const writes = due.map((r) => {
        const tries = (known.get(r.id)?.tries ?? 0) + 1;
        const wait = fileRetryDelay(tries);
        return { attachment_id: r.id, tries, gave_up: wait === null, next_try_at: new Date(now + (wait ?? 0)).toISOString(), updated_at: new Date(now).toISOString() };
      });
      must(await state().upsert(writes, { onConflict: "attachment_id" }), "save file fetch state");
    }
    return due;
  }
}
