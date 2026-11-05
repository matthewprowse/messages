// Seeds Konva Test with the made-up data (fake-data.ts, fake-chats.ts, fake-extras.ts) for each project's own test user:
// the user's data key made as /api/keys makes it, the accounts as the app's connect routes save them (connected, with no
// sign-in stored), email through public.ingest_email, WhatsApp through public.ingest_whatsapp, and what the AI worker and
// the calendar and task workers leave behind. Idempotent: the project user's own rows are deleted first, nobody else's.
// The three users are seeded side by side. Logs counts only.

import { addressIndex } from "@messages/crypto/addresses";
import { admin, type Admin } from "./admin";
import { ACCOUNT, CONVERSATIONS } from "./fake-data";
import { CHATS, WA_ACCOUNT } from "./fake-chats";
import { ingestChats } from "./seed-whatsapp";
import { ingestConversations } from "./seed-email";
import { seedExtras } from "./seed-extras";
import { FIELD, keysFor, seal } from "./seal";
import { assertTestUrl, loadTestEnv } from "./test-env";
import { ensureUser, PROJECTS, type ProjectName } from "./users";
import { writeWorlds, type World } from "./world";

// The user's rows, children first. Deleting the accounts takes their threads, messages and queued work with them (on
// delete cascade); the rest hang off the user. A table this database does not have yet is skipped.
const USER_TABLES = [
  "mail_actions", "bulk_reads", "outbox", "drafts", "follow_ups", "commitments", "message_ai", "thread_labels", "labels", "briefs", "brief_parts",
  "tasks", "task_updates", "calendar_events", "calendar_outbox", "calendar_updates", "calendar_deletes", "unsubscribes", "messages", "threads",
  "contact_identities", "contacts", "organizations", "accounts",
] as const;

async function clearUserRows(db: Admin, userId: string) {
  for (const table of USER_TABLES) {
    const { error } = await (db.from(table) as unknown as { delete: () => { eq: (c: string, v: string) => PromiseLike<{ error: { code?: string } | null }> } }).delete().eq("user_id", userId);
    // 42P01 / PGRST205: a table from a migration Konva Test does not have yet.
    if (error && error.code !== "42P01" && error.code !== "PGRST205") throw Object.assign(new Error(`Could not clear ${table}.`), { code: error.code });
  }
}

/** An account as lib/server/accounts.ts saveAccountRow stores one, but connected and with no account_credentials row: there is no sign-in to use. */
async function addAccount(db: Admin, userId: string, provider: string, label: string, address: string): Promise<string> {
  const keys = await keysFor(userId);
  const { data, error } = await db.from("accounts").insert({
    user_id: userId, provider, label, status: "connected", last_synced_at: new Date().toISOString(),
    address: (await seal(userId, FIELD.address, address))!, address_index: await addressIndex(keys, address),
  }).select("id").single();
  if (error) throw Object.assign(new Error(`Could not create the fake ${provider} account.`), { code: error.code });
  return data.id;
}

/** What the seed made for one project, as counts only. */
export interface Seeded {
  project: ProjectName;
  threads: number;
  messages: number;
  contacts: number;
}

async function seedProject(project: ProjectName): Promise<{ seeded: Seeded; world: World }> {
  const db = admin();
  const userId = await ensureUser(project);

  // Onboarding and the tour are done, so no setup dialog covers the inbox. Merged into what the user already has.
  const { data: user, error: userError } = await db.auth.admin.getUserById(userId);
  if (userError) throw userError;
  const { error: metaError } = await db.auth.admin.updateUserById(userId, { user_metadata: { ...(user.user?.user_metadata ?? {}), onboarding: "done", tour: "done" } });
  if (metaError) throw metaError;

  await keysFor(userId);
  await clearUserRows(db, userId);
  // The profile (kept between runs, not cleared): a name for the greeting, and no automatic pre-drafts, so the only drafts are
  // the ones a test asks for and an opened conversation queues nothing the test did not expect. Pre-drafting is a Settings switch.
  const profile = await db.from("profiles").upsert({ user_id: userId, display_name: "Konva Tester", auto_draft_top: false }, { onConflict: "user_id" });
  if (profile.error) throw Object.assign(new Error("Could not set the test profile."), { code: profile.error.code });

  const accountId = await addAccount(db, userId, ACCOUNT.provider, ACCOUNT.label, ACCOUNT.address);
  const whatsappAccountId = await addAccount(db, userId, WA_ACCOUNT.provider, WA_ACCOUNT.label, WA_ACCOUNT.phone);
  const tasks = await addAccount(db, userId, "google_tasks", "Tasks", "konva-e2e-tasks@example.com");
  const calendar = await addAccount(db, userId, "google_calendar", "Calendar", "konva-e2e-calendar@example.com");

  const world: World = { userId, accountId, whatsappAccountId, threads: {}, messages: {}, roots: {} };
  const now = Date.now();
  let messages = 0;
  for (const made of await ingestConversations(db, userId, accountId, CONVERSATIONS, now)) {
    world.threads[made.key] = made.threadId;
    world.messages[made.key] = made.messages.map((m) => m.id);
    world.roots[made.key] = made.root;
    messages += made.messages.length;
  }
  for (const made of await ingestChats(db, userId, whatsappAccountId, CHATS, now)) world.threads[made.key] = made.threadId;
  messages += CHATS.reduce((n, c) => n + c.messages.length, 0);
  await seedExtras(db, world, { tasks, calendar });

  const count = async (table: "threads" | "contacts") => {
    const { count: n, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (error) throw Object.assign(new Error(`Could not count ${table}.`), { code: error.code });
    return n ?? 0;
  };
  return { seeded: { project, threads: await count("threads"), messages, contacts: await count("contacts") }, world };
}

/** Deletes each project user's rows in Konva Test and writes the made-up data again. Refuses any database but Konva Test. */
export async function seedAll(): Promise<Seeded[]> {
  assertTestUrl(loadTestEnv().SUPABASE_URL);
  const done = await Promise.all(PROJECTS.map(seedProject));
  writeWorlds(Object.fromEntries(done.map((d) => [d.seeded.project, d.world])) as Record<ProjectName, World>);
  return done.map((d) => d.seeded);
}
