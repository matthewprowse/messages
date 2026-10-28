// Works one share job: moves the rows of a chat between the agent's key and the team's (reseal.ts has the per-row
// rules). It reads the rows that still need moving a page at a time, writes each page with the old values it read,
// and goes round again until a pass finds nothing, so it can be stopped at any point and run again, and a message that
// arrives while it works is either picked up by the next pass or by the follow-up job that arrival queued.

import { moveAttachmentFile, type AttachmentRow, type ShareFiles } from "./files";
import { moveMessage, moveMessageAi, moveThread, shareLabel, type Direction, type Keys, type LabelSource, type MessageAiRow, type MessageRow, type Move, type RowWrite, type ThreadRow } from "./reseal";

export type ShareTable = "messages" | "message_ai" | "attachments";

export interface ShareJob {
  id: string;
  thread_id: string;
  workspace_id: string;
  direction: Direction;
}

/** What the job needs of the database (store.ts has the Supabase one, the tests a fake). */
export interface ShareStore {
  thread(id: string): Promise<ThreadRow | null>;
  /** Whether the person is still an active member of the workspace. */
  isActiveMember(workspaceId: string, userId: string): Promise<boolean>;
  /** Up to `limit` rows of the chat that still need moving, in key order, after the key `after`. */
  pending(table: "messages", threadId: string, direction: Direction, after: string | null, limit: number): Promise<MessageRow[]>;
  pending(table: "message_ai", threadId: string, direction: Direction, after: string | null, limit: number): Promise<MessageAiRow[]>;
  pending(table: "attachments", threadId: string, direction: Direction, after: string | null, limit: number): Promise<AttachmentRow[]>;
  /** Writes rows, each only if it still holds what was read. `workspaceId` is the chat's expected workspace (null when going back). Returns how many were written. */
  write(table: ShareTable | "threads", threadId: string, workspaceId: string | null, rows: RowWrite[]): Promise<number>;
  /** What the chat's label is made from. */
  labelSource(thread: ThreadRow): Promise<LabelSource>;
}

export const PAGE_ROWS = 100;
/** How many times round a job goes looking for rows changed meanwhile before it gives up and is tried again later. */
export const MAX_PASSES = 4;

export type ShareOutcome =
  /** Everything is where it should be. */
  | { state: "done"; moved: number }
  /** The chat was shared or moved back again meanwhile, or is gone, or its agent left the team: nothing more to do for this job. */
  | { state: "skipped"; reason: "gone" | "changed" | "left"; moved: number }
  /** Some rows could not be moved, or kept changing: the job is tried again later. */
  | { state: "incomplete"; moved: number; failed: number };

/** The chat is still in the state this job is for. */
function stillCurrent(job: ShareJob, thread: ThreadRow): boolean {
  return job.direction === "to_work" ? thread.workspace_id === job.workspace_id : thread.workspace_id === null;
}

/** `files` copies sealed attachment bytes for the team (files.ts); without it only names and workspace are moved. */
export async function runShareJob(job: ShareJob, store: ShareStore, keys: Keys, files?: ShareFiles): Promise<ShareOutcome> {
  let thread = await store.thread(job.thread_id);
  if (!thread) return { state: "skipped", reason: "gone", moved: 0 };
  if (!stillCurrent(job, thread)) return { state: "skipped", reason: "changed", moved: 0 };
  // Content from someone who has left the team is not shared from then on; what was shared stays, and so does the rest of the history.
  if (job.direction === "to_work" && !(await store.isActiveMember(job.workspace_id, thread.user_id))) return { state: "skipped", reason: "left", moved: 0 };

  const move: Move = { direction: job.direction, userId: thread.user_id, workspaceId: job.workspace_id };
  // The workspace a write is for: where the chat must still be.
  const expected = job.direction === "to_work" ? job.workspace_id : null;
  let moved = 0;
  let failed = 0;
  let attempted = 0;

  /** One table, a page at a time. Returns how many rows were written. */
  const sweep = async <Row extends { id?: string; message_id?: string }>(
    table: ShareTable,
    read: (after: string | null) => Promise<Row[]>,
    change: (row: Row) => Promise<RowWrite | null> | RowWrite | null,
  ): Promise<number> => {
    let written = 0;
    let after: string | null = null;
    for (;;) {
      const rows = await read(after);
      if (!rows.length) break;
      const writes: RowWrite[] = [];
      for (const row of rows) {
        try {
          const write = await change(row);
          if (write) writes.push(write);
        } catch {
          failed++; // a value that cannot be opened is counted, never logged, and the rest still move
        }
      }
      if (writes.length) {
        attempted += writes.length;
        written += await store.write(table, thread!.id, expected, writes);
      }
      const last = rows[rows.length - 1];
      after = (last.message_id ?? last.id)!;
      if (rows.length < PAGE_ROWS) break;
    }
    return written;
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    failed = 0;
    attempted = 0;
    let written = 0;
    written += await sweep("messages", (after) => store.pending("messages", thread!.id, job.direction, after, PAGE_ROWS), (row) => moveMessage(keys, move, row));
    written += await sweep("message_ai", (after) => store.pending("message_ai", thread!.id, job.direction, after, PAGE_ROWS), (row) => moveMessageAi(keys, move, row));
    written += await sweep("attachments", (after) => store.pending("attachments", thread!.id, job.direction, after, PAGE_ROWS), (row) => moveAttachmentFile(keys, files, move, row));

    // The chat's own row last, so its preview and summary follow the messages. It is read again each pass.
    const current = await store.thread(job.thread_id);
    if (!current || !stillCurrent(job, current)) return { state: "skipped", reason: current ? "changed" : "gone", moved: moved + written };
    thread = current;
    try {
      const write = await moveThread(keys, move, thread, async () => shareLabel(await store.labelSource(thread!)));
      if (write) {
        attempted++;
        written += await store.write("threads", thread.id, expected, [write]);
      }
    } catch {
      failed++;
    }
    moved += written;
    // A pass that tried to write nothing found nothing to do (or only rows it could not move): it is the last. One
    // that wrote less than it tried met a row changed meanwhile, which the next pass reads again.
    if (attempted === 0) return failed ? { state: "incomplete", moved, failed } : { state: "done", moved };
  }
  return { state: "incomplete", moved, failed };
}
