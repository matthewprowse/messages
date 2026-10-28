-- A new Instagram conversation can be started from the app, like a new WhatsApp chat: a queued outbox row for
-- one of your own Instagram accounts, with no conversation yet, exactly one recipient (an Instagram username:
-- sealed by the browser, 'e1:...', or plain letters, digits, dots and underscores with or without an @), and no
-- subject or From address. The sign-in connector looks the user up, sends the message and fills in thread_id.
-- The official (Business) connector fails the row with a plain reason: Instagram only lets a Business account
-- message people who wrote first.
-- Added as its own permissive policy rather than by recreating "Queue replies in own conversations", which
-- other migrations (new LinkedIn conversations) also replace; permissive policies are OR'd, so they do not
-- clash. The restrictive policies are unchanged and pass: no Cc or Bcc, and no reply_to_message_id.

create policy "Queue new Instagram conversations" on public.outbox for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'queued'
    and error is null
    and provider_message_id is null
    and sent_at is null
    and (outbox.draft_id is null or exists (
      select 1 from public.drafts d where d.id = outbox.draft_id and d.user_id = (select auth.uid())
    ))
    and outbox.thread_id is null
    and cardinality(outbox.to_addresses) = 1
    and (outbox.to_addresses[1] ~ '^@?[A-Za-z0-9._]{1,30}$' or outbox.to_addresses[1] like 'e1:%')
    and outbox.subject is null
    and outbox.from_address is null
    and exists (
      select 1 from public.accounts a
      where a.id = outbox.account_id and a.user_id = (select auth.uid()) and a.provider = 'instagram'
    )
  );
