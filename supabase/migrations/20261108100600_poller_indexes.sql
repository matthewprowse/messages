-- Indexes for queries the workers run on a loop. All are plain "create index if not exists" (a concurrent build
-- cannot run inside a migration transaction), so on a large table each briefly blocks writes while it builds.
--
-- people job: "where user_id = X order by created_at desc limit 1" on messages.
create index if not exists messages_user_created_idx on public.messages (user_id, created_at desc);
-- chasers: threads waiting on a reply from the other side, newest first. Same filters as the query.
create index if not exists threads_chasers_idx on public.threads (last_message_at desc)
  where last_from_me and not is_group and not junk and status = 'inbox';
-- transcribe: saved audio, newest first. Voice notes are told apart after the sealed name is opened.
create index if not exists attachments_audio_pending_idx on public.attachments (created_at desc)
  where kind = 'audio' and storage_path is not null;
-- triage: the poll reads inbound messages by sent_at desc; messages_inbound_recent_idx
-- (20261024104000) already covers that, and message_ai is looked up by its message_id key, so nothing is added.
