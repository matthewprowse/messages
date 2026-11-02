-- Fixes from the database advisors after the Wave 5 migrations.
--
-- clear_label_removal and note_label_removal are trigger functions (security definer) that
-- 20261119120000_triage_labels_reasons.sql left callable through the API by anyone. Triggers still run them; nobody can
-- call them directly. The three foreign keys below had no index of their own.

revoke execute on function public.clear_label_removal() from public, anon, authenticated;
revoke execute on function public.note_label_removal() from public, anon, authenticated;

create index if not exists ai_batches_user_id_idx on public.ai_batches (user_id);
create index if not exists thread_label_removals_user_id_idx on public.thread_label_removals (user_id);
create index if not exists thread_links_thread_a_idx on public.thread_links (thread_a);
