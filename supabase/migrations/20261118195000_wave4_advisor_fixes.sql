-- Fixes from the database advisors after the Wave 4 migrations.
--
-- clear_snooze_on_inbound is a trigger function (security definer) that 20261118110000_snooze_labels.sql left callable
-- through the API by anyone, unlike every other trigger function. Triggers still run it; nobody can call it directly.
-- The four foreign keys below had no index, so deleting a label, an account's storage queue or a user scanned the table.

revoke execute on function public.clear_snooze_on_inbound() from public, anon, authenticated;

create index if not exists saved_views_label_id_idx on public.saved_views (label_id);
create index if not exists storage_deletions_user_id_idx on public.storage_deletions (user_id);
create index if not exists task_updates_contact_id_idx on public.task_updates (contact_id);
create index if not exists task_updates_user_id_idx on public.task_updates (user_id);
