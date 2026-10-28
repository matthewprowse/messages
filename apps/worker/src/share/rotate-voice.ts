// The team's sealed values that are not a shared chat's rows or the client list, for the key rotation in rotate.ts: the
// company voice (Settings, Team, Company Voice), the log of compliance exports (the client's name) and the team's notes on
// a chat. Each is a "t1:" value, so when a member leaves and the key is rotated it must be sealed again with the current
// key before the old version is retired, or the retired version would take these with it. The rules are the same as for
// the rest (rotate.ts, "TEAM KEY ROTATION"): each write is guarded by the value that was read, a value nothing opens is
// counted and left alone, and the job can be stopped and run again.

import { FIELD, type Field } from "@messages/crypto/fields";
import { db, must } from "../db";

type VoiceTable = "workspace_voice_items" | "compliance_exports" | "thread_notes";
type Cols = readonly (readonly [string, Field])[];

/** Which columns hold what, by row. A company voice item's fields depend on its kind (the same names the app and the AI worker use). */
const VOICE_COLUMNS: Record<string, Cols> = {
  profile: [["body", FIELD.styleRule]],
  template: [["title", FIELD.writingSituation], ["body", FIELD.writingBody]],
  fact: [["title", FIELD.noteTitle], ["body", FIELD.note]],
};

const SPECS: { table: VoiceTable; select: string; columns: (row: Record<string, unknown>) => Cols }[] = [
  { table: "workspace_voice_items", select: "id, kind, title, body", columns: (row) => VOICE_COLUMNS[String(row.kind)] ?? [] },
  { table: "compliance_exports", select: "id, client_label", columns: () => [["client_label", FIELD.name]] },
  { table: "thread_notes", select: "id, body", columns: () => [["body", FIELD.note]] },
];

/** What the pass needs of the database (supabaseVoice below; the tests use a fake). */
export interface VoiceStore {
  /** Up to `limit` rows of the workspace after the id `after`, in id order, with the columns the spec selects. */
  page(table: VoiceTable, select: string, workspaceId: string, after: string | null, limit: number): Promise<Record<string, unknown>[]>;
  /** Writes one row, only if every column in `expect` still holds the value read. Returns whether it did. */
  write(table: VoiceTable, workspaceId: string, id: string, set: Record<string, string | null>, expect: Record<string, string | null>): Promise<boolean>;
}

const PAGE = 100;

/**
 * Seals the workspace's company voice, export log and notes again under the current key. `reseal` is rotate.ts's
 * resealValue for the current ring. Returns how many rows needed a change (attempted), how many were written (moved) and how
 * many held a value nothing opens (failed).
 */
export async function resealVoice(
  workspaceId: string,
  store: VoiceStore,
  reseal: (field: Field, value: string | null) => Promise<string | null>,
): Promise<{ attempted: number; moved: number; failed: number }> {
  let attempted = 0;
  let moved = 0;
  let failed = 0;
  for (const spec of SPECS) {
    let after: string | null = null;
    for (;;) {
      const rows = await store.page(spec.table, spec.select, workspaceId, after, PAGE);
      if (!rows.length) break;
      for (const row of rows) {
        const set: Record<string, string | null> = {};
        const expect: Record<string, string | null> = {};
        try {
          for (const [column, field] of spec.columns(row)) {
            const was = (row[column] as string | null) ?? null;
            const now = await reseal(field, was);
            if (now !== was) {
              expect[column] = was;
              set[column] = now;
            }
          }
        } catch {
          failed++; // a value nothing opens: counted, never logged, and the rest still move
          continue;
        }
        if (!Object.keys(set).length) continue;
        attempted++;
        if (await store.write(spec.table, workspaceId, String(row.id), set, expect)) moved++;
      }
      after = String(rows[rows.length - 1].id);
      if (rows.length < PAGE) break;
    }
  }
  return { attempted, moved, failed };
}

export const supabaseVoice: VoiceStore = {
  async page(table, select, workspaceId, after, limit) {
    // The columns are chosen by name, so the rows are read as plain records.
    let query = (db.from(table) as unknown as { select(s: string): any }).select(select).eq("workspace_id", workspaceId).order("id").limit(limit);
    if (after != null) query = query.gt("id", after);
    return must(await query, `load ${table} to re-seal`) as Record<string, unknown>[];
  },
  async write(table, workspaceId, id, set, expect) {
    let query = (db.from(table) as unknown as { update(v: unknown): any }).update(set).eq("workspace_id", workspaceId).eq("id", id);
    for (const [column, was] of Object.entries(expect)) query = was === null ? query.is(column, null) : query.eq(column, was);
    return (must(await query.select("id"), `re-seal ${table}`) as unknown[]).length > 0;
  },
};
