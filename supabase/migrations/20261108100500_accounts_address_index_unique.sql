-- The only unique rule on accounts is (user_id, provider, address), but addresses are sealed and differ on every
-- encryption, so two connects at once for the same mailbox both succeed and make duplicate accounts. The blind
-- index (address_index, 20261025000300) is the same for the same address, so a unique index on
-- (user_id, provider, address_index) stops that.
-- No rows are deleted. The index is created only when no duplicates exist now; otherwise a notice is raised and
-- the index is skipped, so the migration cannot fail. If skipped, merge the duplicate accounts by hand and run
-- the create statement below again. Plain (non-concurrent) create: it takes a short write lock on accounts,
-- which is a small table.
do $$
begin
  if exists (
    select 1 from public.accounts
    where address_index is not null
    group by user_id, provider, address_index
    having count(*) > 1
  ) then
    raise notice 'accounts_user_provider_address_index_key skipped: duplicate (user_id, provider, address_index) rows exist. Merge them, then rerun: create unique index if not exists accounts_user_provider_address_index_key on public.accounts (user_id, provider, address_index) where address_index is not null';
  else
    create unique index if not exists accounts_user_provider_address_index_key
      on public.accounts (user_id, provider, address_index) where address_index is not null;
  end if;
end $$;
