-- Indexes for queries the workers run on a timer or page through, found by a read-only review of the code against
-- the existing migrations (none of these, or an equivalent, existed). Each comment names the query it serves.
--
-- All are plain "create index if not exists" (a concurrent build cannot run inside a migration transaction), so each
-- briefly blocks writes to its table while it builds. The partial ones read only a small subset and build quickly.
-- The full ones (contact_identities, contacts, address_book_cards) cover every row: fine at today's size, but
-- contact_identities is the largest of the three and the one to watch if the table has grown a lot. Safe to run again.

-- worker/contacts/linker.ts (load identities) and worker/photos/job.ts: "where user_id = $1 order by id", paged by
-- range. With only contact_identities_contact_idx and the unique (user_id, kind, value_index), every page re-sorted
-- the user's whole set.
create index if not exists contact_identities_user_id_idx on public.contact_identities (user_id, id);

-- Same paging shape in worker/contacts/linker.ts for contacts and address_book_cards (the existing user_id indexes
-- find the rows but leave the sort by id for every page). The old single column indexes stay; this migration drops nothing.
create index if not exists contacts_user_id_idx on public.contacts (user_id, id);
create index if not exists address_book_cards_user_id_idx on public.address_book_cards (user_id, id);

-- ai/drafts.py recording cleanup: "status <> 'pending' and audio_path is not null limit 50", run on every sweep.
-- Recordings are cleared once their draft is written, so this index stays nearly empty.
create index if not exists drafts_audio_left_idx on public.drafts (id) where audio_path is not null;

-- ai/drafts.py claim query: "status = 'pending' order by auto, created_at". drafts_pending_idx was on created_at
-- alone, so the order by needed a sort. The new index is created first, then the old one is dropped (its name is from
-- 20261022200000_mail_actions_drafts_usage.sql and nothing renamed it); no other query orders pending drafts by
-- created_at alone.
create index if not exists drafts_pending_order_idx on public.drafts (auto, created_at) where status = 'pending';
drop index if exists public.drafts_pending_idx;

-- ai/learn.py run_once: "status = 'sent' and draft_id is not null order by sent_at desc limit N". Only replies sent
-- from a draft are in it, a small slice of outbox.
create index if not exists outbox_sent_from_draft_idx on public.outbox (sent_at desc) where status = 'sent' and draft_id is not null;
