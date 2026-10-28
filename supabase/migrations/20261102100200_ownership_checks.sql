-- Policies on the mail tables checked only user_id = auth.uid(), so a signed-in user could point their own
-- row at someone else's account, thread, message or contact. Two fixes, by what the browser really does:
--   * Tables the browser never inserts into or deletes from: that is revoked. Ingest, the workers and the
--     SECURITY DEFINER functions (merge_contacts, create_contact and the rest) are unaffected.
--   * threads and messages: the browser only flips flags, so UPDATE is limited to those columns, which also
--     stops account_id, thread_id and similar being rewritten.
--   * Tables the browser writes with foreign keys (drafts, feedback, style_rules): restrictive policies
--     require every referenced row to be the caller's.

-- 1. Server-written tables.
revoke insert, delete, truncate on
  public.threads, public.messages, public.attachments, public.thread_participants, public.message_ai,
  public.draft_outcomes, public.calendar_events, public.contact_identities
from anon, authenticated;
revoke update on
  public.attachments, public.thread_participants, public.message_ai, public.draft_outcomes,
  public.calendar_events, public.contact_identities
from authenticated;

-- 2. Flag-only tables. The browser sets: threads unread_count, pinned, status, junk, priority; messages is_read.
revoke update on public.threads, public.messages from authenticated;
grant update (unread_count, pinned, status, junk, priority) on public.threads to authenticated;
grant update (is_read) on public.messages to authenticated;

-- 3. Tables with references the browser writes.
-- drafts already check thread, account and contact (20261029100500); add the account on a thread draft and
-- the message a pre-draft is for.
create policy "Drafts reference own rows (insert)" on public.drafts as restrictive for insert to authenticated
  with check (
    (account_id is null or exists (select 1 from public.accounts a where a.id = drafts.account_id and a.user_id = (select auth.uid())))
    and (for_message_id is null or exists (select 1 from public.messages m where m.id = drafts.for_message_id and m.user_id = (select auth.uid())))
  );
create policy "Drafts reference own rows (update)" on public.drafts as restrictive for update to authenticated
  with check (
    (account_id is null or exists (select 1 from public.accounts a where a.id = drafts.account_id and a.user_id = (select auth.uid())))
    and (for_message_id is null or exists (select 1 from public.messages m where m.id = drafts.for_message_id and m.user_id = (select auth.uid())))
  );

create policy "Feedback on own rows (insert)" on public.feedback as restrictive for insert to authenticated
  with check (
    exists (select 1 from public.threads t where t.id = feedback.thread_id and t.user_id = (select auth.uid()))
    and (message_id is null or exists (select 1 from public.messages m where m.id = feedback.message_id and m.user_id = (select auth.uid())))
  );
create policy "Feedback on own rows (update)" on public.feedback as restrictive for update to authenticated
  with check (
    exists (select 1 from public.threads t where t.id = feedback.thread_id and t.user_id = (select auth.uid()))
    and (message_id is null or exists (select 1 from public.messages m where m.id = feedback.message_id and m.user_id = (select auth.uid())))
  );

create policy "Style rules on own contacts (insert)" on public.style_rules as restrictive for insert to authenticated
  with check (contact_id is null or exists (select 1 from public.contacts c where c.id = style_rules.contact_id and c.user_id = (select auth.uid())));
create policy "Style rules on own contacts (update)" on public.style_rules as restrictive for update to authenticated
  with check (contact_id is null or exists (select 1 from public.contacts c where c.id = style_rules.contact_id and c.user_id = (select auth.uid())));
