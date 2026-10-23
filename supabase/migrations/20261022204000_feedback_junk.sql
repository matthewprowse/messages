-- Junk corrections from the app ("Move to Junk", "Not Junk") are feedback the AI learns from.
alter table public.feedback drop constraint feedback_value_check;
alter table public.feedback add constraint feedback_value_check
  check (value in ('important', 'not_important', 'junk', 'not_junk'));
create index if not exists feedback_thread_idx on public.feedback (thread_id, created_at desc);
