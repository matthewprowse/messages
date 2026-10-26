-- Cc, Bcc and Reply All on emails sent from the app.
--
-- outbox.cc_addresses and outbox.bcc_addresses are kept exactly like to_addresses: the browser seals each
-- address ("e1:...") when address encryption is on and the worker opens them to send. The outbox has no
-- blind indexes (nothing matches on who a queued message is to), so there is no index column or upkeep
-- trigger to mirror. Empty means none.
--
-- Reply All is the app filling to_addresses and cc_addresses on a reply (a row with thread_id set); the
-- worker sends to exactly those when either is non-empty, and works the recipients out as before when
-- both are empty.
--
-- Copies are email only: a restrictive policy on top of "Queue replies in own conversations" refuses them
-- on a WhatsApp reply or a new WhatsApp chat.

alter table public.outbox add column if not exists cc_addresses text[] not null default '{}';
alter table public.outbox add column if not exists bcc_addresses text[] not null default '{}';

alter table public.outbox drop constraint if exists outbox_copies_check;
alter table public.outbox add constraint outbox_copies_check check (
  cardinality(cc_addresses) <= 100 and cardinality(bcc_addresses) <= 100
);

drop policy if exists "Copies only on email" on public.outbox;
create policy "Copies only on email" on public.outbox as restrictive for insert to authenticated
  with check (
    (cardinality(outbox.cc_addresses) = 0 and cardinality(outbox.bcc_addresses) = 0)
    -- A reply in one of your own email conversations.
    or (outbox.thread_id is not null and exists (
      select 1 from public.threads t
      where t.id = outbox.thread_id and t.user_id = (select auth.uid()) and t.channel = 'email'
    ))
    -- A new email from one of your own email accounts.
    or (outbox.thread_id is null and exists (
      select 1 from public.accounts a
      where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider in ('icloud', 'gmail', 'outlook')
    ))
  );
