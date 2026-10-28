-- Signed-in users could INSERT and DELETE their own accounts rows (the "Own rows" policy covered every command),
-- and each new row earned a fresh AI setup allowance. Rows are now created and removed by the server only
-- (apps/web/lib/server/accounts.ts and the sync worker both use the service role, which bypasses RLS).
-- The browser keeps what it really does: read its accounts, set status (Disconnect) and edit iCloud send
-- addresses. The column grant from 20261022230000 (status, send_addresses) is unchanged.

drop policy "Own rows" on public.accounts;

create policy "Read own accounts" on public.accounts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Update own accounts" on public.accounts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke insert, delete, truncate on public.accounts from anon, authenticated;
revoke update on public.accounts from authenticated;
grant update (status, send_addresses) on public.accounts to authenticated;
