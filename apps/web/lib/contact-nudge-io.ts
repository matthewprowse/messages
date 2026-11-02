// Queues a follow-up reminder made from a contact's page, the way New Task does (a task_updates row the worker hands to
// the user's task list), with the contact on the row so the task ends up tied to them (20261118170000_contact_relationships.sql).

import { FIELD } from "@messages/crypto/fields";
import { followTaskUpdate } from "./app-store/task-follow";
import { supabase } from "./supabase";
import { taskWriteFields, type TaskForm } from "./tasks";
import { seal } from "./vault";

/** Makes the reminder. Resolves to an error sentence for the person, or null once the worker has made the task. */
export async function queueNudge(form: TaskForm, contactId: string, provider: string | undefined): Promise<string | null> {
  const write = taskWriteFields(form, provider);
  const [title, notes] = await Promise.all([seal(FIELD.taskTitle, write.title), seal(FIELD.taskNotes, write.notes)]).catch(() => [null, null] as const);
  if (!title) return "Could not set the reminder. Check your connection and try again.";
  const { data, error } = await supabase
    .from("task_updates")
    .insert({ action: "create", account_id: form.accountId, title, notes, due_at: write.due_at, due_all_day: write.due_all_day, priority: write.priority, contact_id: contactId })
    .select("id")
    .single();
  if (error || !data) return "Could not set the reminder. Check your connection and try again.";
  const result = await followTaskUpdate(data.id, 60_000, 2000, "Setting the reminder is taking too long. Please try again in a moment.");
  return result.status === "failed" ? (result.error ?? "The reminder could not be made.") : null;
}
