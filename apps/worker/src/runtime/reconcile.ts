// Keeps the running connectors in step with the accounts table: new accounts start, disconnected ones stop, accounts
// with fresh credentials restart. One pass at a time, run every 30 s by the startup and on account changes in Realtime.

import { allRows, db, type AccountRow } from "../db";
import { readByIds } from "../in-chunks";
import { errorCode, log } from "../log";
import { ownsAccount } from "../shard";
import { startStaggered } from "../staggered-start";
import { openAddressRows } from "../vault";
import { connectorBlocked } from "../flags";
import { flags } from "../flags-db";
import type { Tables } from "@messages/db";
import { CONNECTORS } from "./registry";
import { running, stopConnector } from "./state";

const ACCOUNT_SETTLE_MS = 1500;

let reconciling = false;
let again = false;

/** One pass at a time: a slow stop() must not let the next tick start a second connector for an account.
 *  A call during a pass runs one more pass after it, so a change that lands mid-pass is not missed. */
export async function reconcile() {
  if (reconciling) { again = true; return; }
  reconciling = true;
  try {
    do {
      again = false;
      await reconcileOnce();
    } while (again);
  } finally {
    reconciling = false;
  }
}

/** Accounts added or changed in the app (connected in onboarding, say) start within seconds rather than at the
 *  next tick. Debounced, because the app saves an account row and then its credentials. */
export function watchAccounts() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => reconcile().catch((err) => log.error("reconcile failed", { code: errorCode(err) })), ACCOUNT_SETTLE_MS);
  };
  db.channel("accounts")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "accounts" }, soon)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "accounts" }, (p) => {
      // The worker's own sync progress lands here too. Only connecting (a new sign-in, a resume) and pausing
      // change which connectors run; a WhatsApp link's code updates while connecting cost one cheap pass each.
      const status = (p.new as Tables<"accounts">).status;
      if (status === "connecting" || status === "disconnected") soon();
    })
    .subscribe();
}

async function reconcileOnce() {
  // Each account with when its credentials last changed, in one light read: only the columns this pass
  // decides on, so nothing is decrypted for an account that is already running and unchanged.
  // Only the accounts this shard owns: a connector for any other account is stopped by the last loop below.
  // Paged and ordered: past 1000 rows the API cuts a plain read off, and the last loop would stop connectors whose rows were cut.
  // The connector kill switches (Admin, Flags) are read once per pass; a blocked account is treated like a paused one: stopped if running, not started.
  await flags.refresh();
  const rows = (
    await allRows(
      (from, to) => db.from("accounts").select("id, user_id, provider, status, account_credentials(updated_at)").in("provider", Object.keys(CONNECTORS)).order("id").range(from, to),
      "load accounts",
    )
  ).filter((a) => ownsAccount(a.id));
  const ids = new Set(rows.map((a) => a.id));

  // Accounts to start (new, or with fresh credentials) are read in full below; the rest never are.
  const wantedStart = (account: (typeof rows)[number]) => {
    const updatedAt = account.account_credentials?.updated_at;
    if (account.status === "disconnected" || updatedAt === undefined || connectorBlocked(flags, account.provider, account.user_id)) return false;
    return running.get(account.id)?.credentialsUpdatedAt !== updatedAt;
  };
  const startIds = rows.filter(wantedStart).map((a) => a.id);
  const full = new Map<string, AccountRow>();
  if (startIds.length > 0) {
    const opened = await openAddressRows(await readByIds(startIds, (slice) => db.from("accounts").select("*").in("id", slice), "load accounts to start"));
    for (const account of opened) full.set(account.id, account);
  }

  const toStart: { account: AccountRow; updatedAt: string }[] = [];
  for (const { account_credentials: credentials, ...summary } of rows) {
    const current = running.get(summary.id);
    const updatedAt = credentials?.updated_at;
    const wanted = summary.status !== "disconnected" && updatedAt !== undefined && !connectorBlocked(flags, summary.provider, summary.user_id);

    if (!wanted) {
      if (current && (await stopConnector(summary.id, current))) {
        running.delete(summary.id);
        log.info("connector stopped", { account: summary.id });
      }
      continue;
    }
    if (current && current.credentialsUpdatedAt === updatedAt) continue;
    const account = full.get(summary.id);
    if (!account) continue; // deleted between the two reads: the next pass settles it

    if (current) {
      if (!(await stopConnector(account.id, current))) continue; // new credentials: restart with them
      running.delete(account.id);
    }
    toStart.push({ account, updatedAt: updatedAt! });
  }

  // Started a few at a time with a little jitter, WhatsApp fewest, so a restart does not open every session in one second.
  // One account that fails to start must not stop the rest: it is tried again on the next pass.
  await startStaggered(
    toStart,
    ({ account }) => account.provider,
    ({ account, updatedAt }) => {
      const connector = CONNECTORS[account.provider](account);
      connector.start();
      running.set(account.id, { connector, credentialsUpdatedAt: updatedAt });
      log.info("connector started", { account: account.id, provider: account.provider });
    },
    ({ account }, err) => log.error("connector start failed", { account: account.id, provider: account.provider, code: errorCode(err) }),
    { limits: { whatsapp: 2, linkedin: 2, instagram: 2 }, defaultLimit: 10 },
  );

  for (const [id, entry] of running) {
    if (!ids.has(id) && (await stopConnector(id, entry))) running.delete(id);
  }
}
