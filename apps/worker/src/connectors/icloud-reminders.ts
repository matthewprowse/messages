import { createHash } from "node:crypto";
import type { Tables, TablesInsert } from "@messages/db";
import { FIELD } from "@messages/crypto/fields";
import { allRows, db, loadCredentials, must, setAccountStatus, touchAccount, type AccountRow } from "../db";
import { env } from "../env";
import { errorCode, log } from "../log";
import { seal } from "../vault";
import { TaskUpdateError, taskOfUpdate } from "../tasks";
import { taskFields, type RelaySync, type RelayUpdate, type TaskFields } from "../reminders/protocol";
import type { RelayAccount } from "../reminders/server";

// iCloud Reminders through Konva Relay, a small app on the user's Mac (apps/mac-relay). Since iOS 13, upgraded
// Reminders lists are kept where CalDAV cannot see them, and iCloud's own web API needs the Apple ID password,
// so the relay reads them with EventKit on the Mac and posts them to the relay endpoint (reminders/server.ts).
// This connector holds no connection of its own: it waits for its relay, stores each sync into tasks, and hands
// the relay the ticks made in the app (task_updates), which the relay applies in Reminders and reports back.
// The account's credentials are only the hash of its relay token.

export interface ICloudRemindersCredentials {
  /** SHA-256 of the relay token, as relayTokenHash makes it. The token itself is shown once and never stored. */
  tokenHash: string;
}

const STALE_MS = 30 * 60_000; // a relay that has not checked in for this long is marked as needing attention
const CHECK_MS = 60_000;
const REPORT_WAIT_MS = 60_000; // how long a change waits for the relay to report before it is failed
const WRITE_ROWS = 500;
const UPDATES_AT_ONCE = 50;

const WAITING = "Waiting for Konva Relay on your Mac to check in.";
const STALE = "Konva Relay on your Mac has not checked in for 30 minutes. Check the Mac is on and awake, and Konva Relay is running.";
const DENIED = "Konva Relay is not allowed to read Reminders on your Mac. Allow it in System Settings, Privacy and Security, Reminders.";
const OFF = "The reminders relay is switched off in the worker. Set RELAY_PORT in apps/worker/.env, then restart it.";
const OFFLINE = "Konva Relay on your Mac is not checking in, so this was not changed in Reminders. Check the Mac is on, then try again.";

/** Running connectors by their relay token's hash: the relay endpoint finds an account only through here. */
const relays = new Map<string, ICloudRemindersConnector>();

export const relayAccount = (tokenHash: string): RelayAccount | undefined => relays.get(tokenHash);

type RelayResult = { ok: true } | { ok: false; error: string };

/** What a stored task was last written as, kept as a hash so the plain text is not held in memory. */
const fingerprint = (fields: TaskFields) => createHash("sha256").update(JSON.stringify(fields)).digest("base64");

export class ICloudRemindersConnector implements RelayAccount {
  private stopped = false;
  private tokenHash: string | null = null;
  private status: "connecting" | "connected" | "error" = "connecting";
  /** When the relay last made any request. Starts at now, so a restart gives it time to come back. */
  private lastSeen = Date.now();
  /** The Mac said it may not read Reminders: polls do not count as connected until a full sync comes. */
  private denied = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Each stored reminder's fingerprint, so a sync rewrites only what changed. Empty after a restart. */
  private readonly written = new Map<string, string>();
  /** Long polls waiting for a change to be queued. */
  private readonly polls = new Set<() => void>();
  /** Queued changes handed over by updateTask, waiting for the relay to report on them. */
  private readonly reports = new Map<string, (result: RelayResult | null) => void>();
  /** Syncs are stored one at a time, so two cannot interleave their removals. */
  private syncing: Promise<unknown> = Promise.resolve();

  constructor(private readonly account: AccountRow) {}

  get id() {
    return this.account.id;
  }

  start() {
    void this.run();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    if (this.tokenHash && relays.get(this.tokenHash) === this) relays.delete(this.tokenHash);
    for (const wake of this.polls) wake();
    for (const answer of this.reports.values()) answer(null);
  }

  private async run() {
    try {
      if (!env.relayPort) {
        await setAccountStatus(this.id, "error", OFF);
        return;
      }
      const creds = await loadCredentials<ICloudRemindersCredentials>(this.id);
      if (this.stopped) return;
      this.tokenHash = creds.tokenHash;
      relays.set(creds.tokenHash, this);
      await setAccountStatus(this.id, "connecting", WAITING);
      this.timer = setInterval(() => void this.checkStale(), CHECK_MS);
    } catch (err) {
      log.warn("icloud reminders start failed", { account: this.id, code: errorCode(err) });
      await setAccountStatus(this.id, "error", "iCloud Reminders could not start. Make a new relay token in Settings.").catch(() => undefined);
    }
  }

  private async setStatus(status: "connected" | "error", detail: string | null = null) {
    if (this.stopped) return;
    const before = this.status;
    this.status = status;
    if (before !== status) await setAccountStatus(this.id, status, detail).catch((err) => log.warn("icloud reminders status not saved", { account: this.id, code: errorCode(err) }));
  }

  /** Any request from the relay: it is alive. */
  private async seen() {
    this.lastSeen = Date.now();
    if (!this.denied) await this.setStatus("connected");
  }

  private async checkStale() {
    if (this.status !== "error" && Date.now() - this.lastSeen > STALE_MS) {
      log.warn("icloud reminders relay stale", { account: this.id });
      await this.setStatus("error", STALE);
    }
  }

  /** A full copy of the Mac's reminders: stored, and anything no longer in it removed. */
  sync(sync: RelaySync): Promise<{ stored: number; removed: number }> {
    const run = this.syncing.then(() => this.store(sync));
    this.syncing = run.catch(() => undefined);
    return run;
  }

  private async store(sync: RelaySync): Promise<{ stored: number; removed: number }> {
    if (this.stopped) return { stored: 0, removed: 0 };
    if (sync.access === "denied") {
      this.denied = true;
      this.lastSeen = Date.now();
      await this.setStatus("error", DENIED);
      return { stored: 0, removed: 0 };
    }
    this.denied = false;
    await this.seen();
    // Every Reminders library has a list. None means the Mac has not loaded iCloud yet, not that all is gone.
    if (sync.lists.size === 0) return { stored: 0, removed: 0 };

    const userId = this.account.user_id;
    const fields = sync.reminders.map((r) => taskFields(r, sync));
    const changed = fields.map((f) => ({ f, print: fingerprint(f) })).filter(({ f, print }) => this.written.get(f.provider_task_id) !== print);
    for (let i = 0; i < changed.length; i += WRITE_ROWS) {
      const batch = changed.slice(i, i + WRITE_ROWS);
      const rows: TablesInsert<"tasks">[] = await Promise.all(
        batch.map(async ({ f }) => ({
          ...f,
          user_id: userId,
          account_id: this.id,
          title: (await seal(userId, FIELD.taskTitle, f.title)) ?? "",
          notes: await seal(userId, FIELD.taskNotes, f.notes),
          list_name: await seal(userId, FIELD.taskList, f.list_name),
        })),
      );
      must(await db.from("tasks").upsert(rows, { onConflict: "account_id,provider_task_id" }), "store reminders");
      for (const { f, print } of batch) this.written.set(f.provider_task_id, print);
    }

    const keep = new Set(fields.map((f) => f.provider_task_id));
    const stored = await allRows(
      (from, to) => db.from("tasks").select("id, provider_task_id").eq("account_id", this.id).order("id").range(from, to),
      "load stored reminders",
    );
    const gone = stored.filter((t) => !keep.has(t.provider_task_id));
    for (let i = 0; i < gone.length; i += WRITE_ROWS) {
      const batch = gone.slice(i, i + WRITE_ROWS);
      must(await db.from("tasks").delete().eq("account_id", this.id).in("id", batch.map((t) => t.id)), "remove reminders");
      for (const t of batch) this.written.delete(t.provider_task_id);
    }
    await touchAccount(this.id);
    log.info("icloud reminders synced", { account: this.id, lists: sync.lists.size, reminders: fields.length, written: changed.length, removed: gone.length });
    return { stored: changed.length, removed: gone.length };
  }

  /**
   * This account's changes under way, oldest first, so a tick and an untick reach Reminders in order. The
   * worker claims each one ("updating") before handing it to updateTask, which is waiting on the relay.
   */
  private async queued(): Promise<RelayUpdate[]> {
    const rows = must(
      await db
        .from("task_updates")
        .select("id, action, tasks!inner(provider_task_id, account_id)")
        .eq("status", "updating")
        .eq("user_id", this.account.user_id)
        .eq("tasks.account_id", this.id)
        .order("created_at")
        .limit(UPDATES_AT_ONCE),
      "load task updates",
    );
    return rows.flatMap((r) => (r.action === "complete" || r.action === "reopen" ? [{ id: r.id, reminderId: r.tasks.provider_task_id, action: r.action }] : []));
  }

  async updates(waitMs: number, signal: AbortSignal): Promise<RelayUpdate[]> {
    await this.seen();
    const now = await this.queued();
    if (now.length > 0 || waitMs <= 0 || this.stopped) return now;
    await new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.polls.delete(wake);
        signal.removeEventListener("abort", wake);
        resolve();
      };
      const timer = setTimeout(wake, waitMs);
      this.polls.add(wake);
      signal.addEventListener("abort", wake, { once: true });
    });
    return signal.aborted || this.stopped ? [] : this.queued();
  }

  /** The relay's answer for a change: handed to the updateTask waiting on it, which the worker then settles. */
  async report(id: string, result: RelayResult): Promise<boolean> {
    await this.seen();
    const row = must(
      await db.from("task_updates").select("id, action, status, user_id, tasks!inner(account_id)").eq("id", id).maybeSingle(),
      "load task update",
    );
    if (!row || row.status !== "updating" || row.user_id !== this.account.user_id || row.tasks.account_id !== this.id) return false;
    const answer = this.reports.get(id);
    if (!answer) return false; // no longer waited on: it timed out and was failed
    answer(result);
    log.info("icloud reminders change applied", { account: this.id, update: id, action: row.action, ok: result.ok });
    return true;
  }

  /**
   * A tick or untick made in the app, already claimed by the worker (apps/worker/src/tasks). The relay applies
   * it in Reminders on the Mac (it is woken from its long poll at once) and reports back; this resolves on
   * success and throws with the reason otherwise, and the worker settles the row. When the relay has gone
   * quiet the change fails at once rather than waiting for a Mac that may be off.
   */
  async updateTask(row: Tables<"task_updates">): Promise<void> {
    if (this.stopped) throw new TaskUpdateError(OFFLINE);
    const task = await taskOfUpdate(row);
    if (!task || task.account_id !== this.id || row.user_id !== this.account.user_id) throw new TaskUpdateError("This task belongs to another account.");
    if (Date.now() - this.lastSeen > STALE_MS) throw new TaskUpdateError(OFFLINE);
    const result = await new Promise<RelayResult | null>((resolve) => {
      const answer = (value: RelayResult | null) => {
        clearTimeout(timer);
        if (this.reports.get(row.id) === answer) this.reports.delete(row.id);
        resolve(value);
      };
      const timer = setTimeout(() => answer(null), REPORT_WAIT_MS);
      this.reports.set(row.id, answer);
      for (const wake of [...this.polls]) wake();
    });
    if (!result) throw new TaskUpdateError("Your Mac did not confirm the change in time. If it is on, the change may still go through.");
    if (!result.ok) throw new TaskUpdateError(result.error);
  }
}
