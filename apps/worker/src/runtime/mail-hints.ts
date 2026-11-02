// Hears "sync this account now" hints from the mail_hints table (written by the web app's Graph notification route) and
// wakes the Outlook connector for that account. The web app and the worker never call each other: they meet in this
// table, and Realtime delivers each change. A Realtime gap is covered twice: every (re)subscribe reads the hints made in
// the last few minutes, and the connector's slow poll still runs. The channel opens the first time a connector asks.

import { db } from "../db";
import { errorCode, log } from "../log";
import { HintDebouncer } from "./hint-debounce";

const CATCH_UP_MS = 10 * 60_000; // hints this recent are re-read when the channel (re)subscribes

const wakers = new Map<string, () => void>();
const debouncer = new HintDebouncer((accountId) => wakers.get(accountId)?.());
let opened = false;

/** Registers what to do when this account is hinted. Returns the way to stop. */
export function onMailHint(accountId: string, wake: () => void): () => void {
  openHints();
  wakers.set(accountId, wake);
  return () => {
    if (wakers.get(accountId) === wake) { wakers.delete(accountId); debouncer.forget(accountId); }
  };
}

function openHints() {
  if (opened) return;
  opened = true;
  const hint = (row: unknown) => {
    const id = (row as { account_id?: unknown } | null)?.account_id;
    if (typeof id === "string" && wakers.has(id)) debouncer.hint(id);
  };
  db.channel("mail-hints")
    .on("postgres_changes", { event: "*", schema: "public", table: "mail_hints" }, (p) => hint(p.new))
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // A hint written while the channel was down: read the recent ones. Only ids and a time, never content.
      void Promise.resolve(db.from("mail_hints").select("account_id").gte("hinted_at", new Date(Date.now() - CATCH_UP_MS).toISOString()).limit(1000))
        .then(({ data }) => { for (const row of data ?? []) hint(row); })
        .catch((err) => log.warn("mail hints catch up failed", { code: errorCode(err) }));
    });
}
