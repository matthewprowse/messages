-- Old bulk mail (newsletters, marketing, automated) is shortened to a preview after 30 days by the sync worker
-- (apps/worker/src/ingest/shrink-bulk.ts): the sealed body_text keeps about its first 500 characters, body_marks
-- is cleared, and body_shrunk_at records when. The full original is still read through View Original, which
-- fetches it from the provider using provider_meta, so nothing View Original needs is touched.
--
-- Plain (non-concurrent) builds: the index is partial and the column has no default, so both are quick.

alter table public.messages add column if not exists body_shrunk_at timestamptz;

-- The worker's queue: bulk mail not yet shortened, oldest first.
create index if not exists messages_bulk_unshrunk_idx on public.messages (sent_at) where is_bulk and body_shrunk_at is null;

-- "Has this person been written to": the worker looks up outbound mail by a recipient's blind index.
create index if not exists messages_outbound_to_indexes_idx on public.messages using gin (to_indexes) where direction = 'outbound';
