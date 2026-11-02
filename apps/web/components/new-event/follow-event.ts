// Waits for the worker to create a queued event: the outbox row's shape, when it counts as final, and how long the
// New Event dialog waits for it. A give-up is not a failure (the worker may still create it).

import type { Tables } from "@messages/db";
import { followRow } from "@/lib/follow-row";
import { GAVE_UP } from "@/lib/calendar";

const POLL_MS = 1500; // in case a Realtime update is missed
const GIVE_UP_MS = 60_000; // how long the worker is waited for once the dialog has closed

export type Row = Pick<Tables<"calendar_outbox">, "status" | "error" | "html_link">;

const isFinal = (r: Row) => r.status === "created" || r.status === "failed";
// Not a failure: the worker may still create it, so the dialog does not invite a second try.
const GIVE_UP: Row = { status: GAVE_UP, error: null, html_link: null };

/** Resolves when the worker has created the queued event or given up, or after GIVE_UP_MS. */
export const followEvent = (id: string) => followRow<Row>("calendar_outbox", id, "status, error, html_link", isFinal, GIVE_UP, { giveUpMs: GIVE_UP_MS, pollMs: POLL_MS });
