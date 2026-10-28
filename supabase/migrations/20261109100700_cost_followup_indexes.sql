-- Indexes and one column that the worker and web cost changes rely on. All plain "create index if not exists"
-- (a concurrent build cannot run inside a migration transaction), so each briefly blocks writes while it builds;
-- every table here is small. Nothing is dropped.
--
-- Company logo job (apps/worker/src/logos/job.ts): it now checks only organizations created since a watermark
-- or still without a logo, and deletes the review sheet files of finished logos a few days later. review_cleared_at
-- records that those files are gone, so each domain is cleaned once.
alter table public.company_logos add column if not exists review_cleared_at timestamptz;
create index if not exists company_logos_review_todo_idx on public.company_logos (updated_at)
  where status = 'done' and review_cleared_at is null;
create index if not exists organizations_logo_path_null_idx on public.organizations (id) where logo_path is null;
create index if not exists organizations_created_at_idx on public.organizations (created_at);
--
-- Contact linker (apps/worker/src/contacts/dirty.ts): every 15 minutes it asks which users have a contact, card or
-- identity changed since the last run, instead of reloading everyone.
create index if not exists contacts_updated_at_idx on public.contacts (updated_at);
create index if not exists contact_identities_created_at_idx on public.contact_identities (created_at);
create index if not exists address_book_cards_updated_at_idx on public.address_book_cards (updated_at);
--
-- Meeting linker (apps/worker/src/meetings/linker.ts): it reads only participants and meetings not yet linked.
create index if not exists meeting_participants_unlinked_idx on public.meeting_participants (id)
  where contact_id is null and not is_self and address is not null;
create index if not exists meetings_unlinked_idx on public.meetings (started_at) where calendar_event_id is null;
--
-- Web delta resync (apps/web/lib/app-store/use-realtime.ts): after a short Realtime drop it reads only the threads
-- changed since the drop, "where user_id = X and updated_at > T".
create index if not exists threads_user_updated_idx on public.threads (user_id, updated_at desc);
--
-- AI voice and people jobs (apps/ai/ai/voice.py, people.py): one global probe of messages created since the last
-- pass finds which users have something new, instead of one query per user.
create index if not exists messages_created_at_idx on public.messages (created_at desc);
