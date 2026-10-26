-- New emails can be sent from any IMAP and SMTP mailbox ('imap' accounts), with copies, like iCloud, Gmail
-- and Outlook. Both outbox insert policies are otherwise exactly as last set (20261026100000_microsoft_accounts.sql
-- and 20261028110000_outbox_cc_bcc.sql). Replies in Teams, Zoom, Google Chat, LinkedIn and Instagram
-- conversations already pass: a reply only needs to be in your own conversation.

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
    )
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
      where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider in ('icloud', 'gmail', 'outlook', 'imap')
    ))
  );
