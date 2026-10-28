-- Creating, editing and deleting tasks from the app, not just ticking them. They go through the same queue
-- as a tick (task_updates): the app queues a row, the worker hands it to the task's connector and settles it.
--
--   create: account_id, title, and optionally notes, due_at, due_all_day, priority. No task_id yet; once the
--           provider has the task, the connector stores it in public.tasks like a synced one.
--   update: task_id and the whole wanted state of title, notes, due_at, due_all_day and priority. A null
--           notes, due_at or priority clears it at the provider.
--   delete: task_id. The worker removes the task row once the provider has deleted it.
--
-- title and notes are sealed per user, like public.tasks (FIELD.taskTitle, FIELD.taskNotes), so a typed task
-- never sits in the database as plain text. The app seals them in the browser.

alter table public.task_updates drop constraint task_updates_action_check;
alter table public.task_updates add constraint task_updates_action_check
  check (action in ('complete', 'reopen', 'create', 'update', 'delete'));

alter table public.task_updates alter column task_id drop not null;
alter table public.task_updates
  add column account_id uuid references public.accounts (id) on delete cascade,
  add column title text,
  add column notes text,
  add column due_at timestamptz,
  add column due_all_day boolean not null default false,
  add column priority smallint check (priority is null or priority between 1 and 3);

-- Deleting a task at the provider removes its row here, which must not delete the record of the delete.
alter table public.task_updates drop constraint task_updates_task_id_fkey;
alter table public.task_updates add constraint task_updates_task_id_fkey
  foreign key (task_id) references public.tasks (id) on delete set null;
alter table public.task_updates add constraint task_updates_target_check
  check (
    (action = 'create' and task_id is null and account_id is not null and title is not null)
    or action <> 'create'
  );

drop policy "Queue updates to own tasks" on public.task_updates;
create policy "Queue updates to own tasks" on public.task_updates for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and (
      (action = 'create' and exists (
        select 1 from public.accounts a
        where a.id = task_updates.account_id and a.user_id = (select auth.uid())
          and a.provider in ('microsoft_todo', 'google_tasks', 'icloud_reminders')
      ))
      or (action <> 'create' and exists (select 1 from public.tasks t where t.id = task_updates.task_id and t.user_id = (select auth.uid())))
    )
  );
