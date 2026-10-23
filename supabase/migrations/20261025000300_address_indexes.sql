-- Encryption, stage 2, step 1: a blind index beside every address-like value, so the database can keep
-- matching senders to contacts, chats to conversations and people to companies once the values are
-- encrypted. An index is an HMAC of the value under the user's index key, written one standard way
-- (packages/crypto/src/addresses.ts), so only an exact match is possible. Nothing reads these yet: the
-- writers fill them next, a backfill fills existing rows, and only then do the functions switch over.

alter table public.contact_identities add column value_index text;
alter table public.messages add column sender_index text, add column to_indexes text[];
alter table public.threads add column provider_thread_index text;
alter table public.unsubscribes add column sender_index text;
alter table public.organizations add column domain_index text;
alter table public.priority_rules add column target_index text;
-- The user's own addresses, which keep their own domains out of companies and their own identities out
-- of automatic merges.
alter table public.accounts add column address_index text, add column send_address_indexes text[];

-- The same uniqueness the readable columns have, once a row has an index.
create unique index contact_identities_value_index_key on public.contact_identities (user_id, kind, value_index) where value_index is not null;
create unique index threads_provider_thread_index_key on public.threads (account_id, provider_thread_index) where provider_thread_index is not null;
create unique index unsubscribes_sender_index_key on public.unsubscribes (user_id, account_id, sender_index) where sender_index is not null;
create unique index organizations_domain_index_key on public.organizations (user_id, domain_index) where domain_index is not null;
create unique index priority_rules_target_index_key on public.priority_rules (user_id, kind, target_index) where target_index is not null;
create index messages_sender_index_idx on public.messages (account_id, sender_index, sent_at desc) where sender_index is not null;
