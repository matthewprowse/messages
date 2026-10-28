-- The worker's address indexer (apps/worker/src/address-indexer.ts) wakes every 30 seconds and, for each of eight
-- tables, asks for up to 200 rows whose blind index is still null, in id order. With nothing to index, that was
-- eight scans of whole tables every pass. These partial indexes hold only the rows still waiting, so an idle pass
-- reads an empty index and costs nothing. Each is written to match the query: "where <column> is null order by id".
-- A row leaves its index the moment the worker writes the blind index, and re-enters it when a changed value
-- clears the index (20261025000400), so the indexes stay tiny.
--
-- All are plain "create index if not exists" (a concurrent build cannot run inside a migration transaction), so on
-- a large table each briefly blocks writes while it builds. Only rows with a null column are read, so the build is
-- quick even on big tables. Safe to run again.

create index if not exists contact_identities_value_index_todo_idx on public.contact_identities (id) where value_index is null;
create index if not exists messages_to_indexes_todo_idx on public.messages (id) where to_indexes is null;
create index if not exists threads_provider_thread_index_todo_idx on public.threads (id) where provider_thread_index is null;
create index if not exists unsubscribes_sender_index_todo_idx on public.unsubscribes (id) where sender_index is null;
create index if not exists organizations_domain_index_todo_idx on public.organizations (id) where domain_index is null;
create index if not exists priority_rules_target_index_todo_idx on public.priority_rules (id) where target_index is null;
create index if not exists accounts_send_address_indexes_todo_idx on public.accounts (id) where send_address_indexes is null;
create index if not exists address_book_cards_email_indexes_todo_idx on public.address_book_cards (id) where email_indexes is null;
