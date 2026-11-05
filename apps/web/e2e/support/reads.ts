// Read only looks at the project user's rows in Konva Test, so a test can check what the app wrote without trusting the
// screen: a conversation's state, its labels, the unsubscribe requests queued. Nothing is changed here. Counts, ids,
// statuses and times only; sealed text is opened only where a test names the field.

import { admin } from "./admin";
import { testUserId, type ProjectName } from "./users";

const fail = (what: string, error: { code?: string }) => Object.assign(new Error(`Could not ${what}.`), { code: error.code });

/** A conversation's state columns as the database has them now. */
export async function threadState(project: ProjectName, threadId: string) {
  const { data, error } = await admin().from("threads").select("status, junk, pinned, unread_count, snoozed_until, snooze_kind, last_message_at, last_message_preview")
    .eq("user_id", await testUserId(project)).eq("id", threadId).single();
  if (error) throw fail("read the conversation", error);
  return data;
}

/** The names of the labels a conversation wears. */
export async function labelNamesOf(project: ProjectName, threadId: string): Promise<string[]> {
  const { data, error } = await admin().from("thread_labels").select("labels(name)").eq("user_id", await testUserId(project)).eq("thread_id", threadId);
  if (error) throw fail("read thread_labels", error);
  return data.map((r) => (r.labels as unknown as { name: string }).name).sort();
}

/** Every mail action queued for a conversation, newest first. */
export async function mailActionsOf(project: ProjectName, threadId: string) {
  const { data, error } = await admin().from("mail_actions").select("id, action, status").eq("user_id", await testUserId(project)).eq("thread_id", threadId)
    .order("created_at", { ascending: false });
  if (error) throw fail("read mail_actions", error);
  return data;
}

/** The unsubscribe requests queued, by status. */
export async function unsubscribeStatuses(project: ProjectName): Promise<string[]> {
  const { data, error } = await admin().from("unsubscribes").select("status").eq("user_id", await testUserId(project));
  if (error) throw fail("read unsubscribes", error);
  return data.map((r) => r.status);
}

/** The newest brief's status, or null when there is none. */
export async function briefStatus(project: ProjectName): Promise<string | null> {
  const { data, error } = await admin().from("briefs").select("status").eq("user_id", await testUserId(project)).order("created_at", { ascending: false }).limit(1);
  if (error) throw fail("read briefs", error);
  return data[0]?.status ?? null;
}
