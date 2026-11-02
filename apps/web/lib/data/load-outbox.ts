// Loads the signed-in user's queued and failed replies so they show again after a reload (read only: nothing is sent).

import { supabase } from "../supabase";
import { open } from "../vault";
import { FIELD } from "@messages/crypto/fields";
import type { PendingSend } from "../app-store/compose";
import { OUTBOX_LOAD_LIMIT, readDismissed, shownRows } from "../outbox-load";
import { myId } from "./load-small";

/**
 * The signed-in user's queued and failed replies, oldest first, so they show again after a reload. Bodies and addresses
 * are opened here. Rows the person already deleted (kept in this browser) and long-stale failures are left out.
 */
export async function loadOutbox(): Promise<PendingSend[]> {
  const me = await myId();
  const { data, error } = await supabase.from("outbox")
    .select("id, thread_id, body, status, error, created_at, from_address, to_addresses, cc_addresses, attachment_count")
    .eq("user_id", me).not("thread_id", "is", null).in("status", ["queued", "sending", "failed"])
    .order("created_at", { ascending: false }).limit(OUTBOX_LOAD_LIMIT);
  if (error) throw error;
  const openList = (list: string[]) => Promise.all(list.map(async (a) => (await open(FIELD.address, a)) ?? "")).then((l) => l.filter(Boolean));
  const rows = shownRows(data ?? [], readDismissed());
  const opened = await Promise.all(rows.map(async (p) => ({
    ...p,
    body: (await open(FIELD.body, p.body)) ?? "",
    fromAddress: p.fromAddress ? (await open(FIELD.address, p.fromAddress)) ?? undefined : undefined,
    copies: p.copies ? { to: await openList(p.copies.to), cc: await openList(p.copies.cc) } : undefined,
  })));
  return opened.reverse();
}
