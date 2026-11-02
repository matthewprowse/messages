// Cancelling a queued message (Undo, Cancel on a scheduled one) and sending it now. Both are database functions that act
// only while the row is still queued, so a message the worker has already taken cannot be cancelled. The rpc is a parameter
// (use-outbox.ts passes the Supabase client's) so the answers are tested without a network or the browser client.

export type Rpc = (fn: "cancel_outbox" | "send_outbox_now", args: { p_id: string }) => PromiseLike<{ data: boolean | null; error: unknown }>;

/** true: cancelled and gone. false: too late, the worker has it. null: the answer was lost, so it is not known. */
export async function cancelOutbox(id: string, rpc: Rpc): Promise<boolean | null> {
  try {
    const { data, error } = await rpc("cancel_outbox", { p_id: id });
    return error || data === null ? null : data;
  } catch { return null; }
}

/** true: it is due now and the worker will take it. false: it is not queued any more. null: not known. */
export async function sendOutboxNow(id: string, rpc: Rpc): Promise<boolean | null> {
  try {
    const { data, error } = await rpc("send_outbox_now", { p_id: id });
    return error || data === null ? null : data;
  } catch { return null; }
}
