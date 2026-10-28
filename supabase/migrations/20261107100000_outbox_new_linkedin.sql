-- A new LinkedIn conversation can be started from the app, the way a new WhatsApp chat is: a queued outbox
-- row for one of your own LinkedIn accounts, with no conversation yet, exactly one recipient and no subject or
-- From address. The recipient is a LinkedIn profile URN or profile link (the worker checks it once it is
-- decrypted; the database only sees ciphertext). The worker sends the first message, then fills in
-- thread_id, or fails the row with the reason. Only the "Queue replies in own conversations" insert policy
-- changes: it is exactly as last set (20261030220000_outbox_imap.sql) plus the LinkedIn branch below. The
-- restrictive policies are unchanged and pass: no Cc or Bcc, and no reply_to_message_id.

drop policy if exists "Queue replies in own conversations" on public.outbox;
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
        where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider in ('icloud', 'gmail', 'outlook', 'imap')
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
      -- A new LinkedIn conversation: your own LinkedIn account, one recipient (a profile URN or link, or its
      -- ciphertext), no subject or From address.
      or (outbox.thread_id is null
        and cardinality(outbox.to_addresses) = 1
        and length(outbox.to_addresses[1]) between 1 and 2000
        and outbox.subject is null
        and outbox.from_address is null
        and exists (
          select 1 from public.accounts a
          where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider = 'linkedin'
        ))
    )
  );
