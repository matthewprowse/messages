-- Microsoft: Outlook mail and Outlook Calendar accounts, connected with one Microsoft sign-in.
--
-- 1. The two new providers.
-- 2. account_credentials.refreshed keeps the newest refresh token. Microsoft issues a new one on every
--    refresh and each expires 90 days after it was issued, so the worker must keep them. Only a change to
--    ciphertext (a new sign-in) moves updated_at, which is what restarts a connector; keeping a refreshed
--    token must not.
-- 3. New emails can be sent from an Outlook account. The policy is otherwise the same as in
--    20261025001200_outbox_addresses.sql.
-- 4. Outlook messages are found by their Graph ID, as Gmail's are by theirs.

alter table public.accounts drop constraint accounts_provider_check;
alter table public.accounts add constraint accounts_provider_check
  check (provider in ('icloud', 'gmail', 'google_calendar', 'outlook', 'outlook_calendar', 'whatsapp'));

alter table public.account_credentials add column refreshed text;
comment on column public.account_credentials.refreshed is
  'Encrypted credentials with the newest refresh token (Microsoft rotates them). Cleared by a new sign-in.';

drop trigger set_updated_at on public.account_credentials;
create trigger set_updated_at before update of ciphertext on public.account_credentials
  for each row execute function public.set_updated_at();

drop policy "Queue replies in own conversations" on public.outbox;
create policy "Queue replies in own conversations" on public.outbox for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and error is null
    and provider_message_id is null
    and sent_at is null
    and (outbox.draft_id is null or exists (
      select 1 from public.drafts d where d.id = outbox.draft_id and d.user_id = (select auth.uid())
    ))
    and (
      -- A reply: your own conversation, and if an account is named it must be that conversation's.
      (outbox.thread_id is not null and exists (
        select 1 from public.threads t
        where t.id = outbox.thread_id and t.user_id = (select auth.uid())
          and (outbox.account_id is null or t.account_id = outbox.account_id)
      ))
      -- A new email: one of your own email accounts.
      or (outbox.thread_id is null and exists (
        select 1 from public.accounts a
        where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider in ('icloud', 'gmail', 'outlook')
      ))
      -- A new WhatsApp chat: your own WhatsApp account, one phone number (checked by the worker once it is
      -- encrypted), no subject or From address.
      or (outbox.thread_id is null
        and cardinality(outbox.to_addresses) = 1
        and (outbox.to_addresses[1] ~ '^\+[1-9][0-9]{6,14}$' or outbox.to_addresses[1] like 'e1:%')
        and outbox.subject is null
        and outbox.from_address is null
        and exists (
          select 1 from public.accounts a
          where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider = 'whatsapp'
        ))
    )
  );

create index if not exists messages_graph_id_idx on public.messages (account_id, (provider_meta->>'graph_id'));
