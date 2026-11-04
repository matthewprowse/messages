-- Every id a user writes into one of their own rows must point at one of their own rows (security audit 2026-11-03,
-- Low, ownership defence in depth). The tables below checked the row's user_id but not the ids it refers to, so a row
-- could name another person's account, contact, conversation, event, note, file, meeting or label. RLS still hid the
-- other person's data, but a foreign id should never be stored, and account_composer's could squat another person's
-- account (its key is account_id, so a row for someone else's account stopped them saving their own signature).
--
-- The checks follow 20261102100200_ownership_checks.sql: extra restrictive policies for insert and update, so the
-- existing policies stay as they are and a write must pass both. The workers use the service role and are not affected.
--
--   * account_composer: the account must be the caller's own. The app only ever saves settings for the accounts in the
--     caller's own Settings (they are sealed with the caller's key, so a shared inbox member's row could not be read by
--     anyone else anyway). The key stays account_id, so the app's upsert (onConflict account_id) works unchanged, and a
--     row someone made for an account that is not theirs is removed so the owner can save again.
--   * note_links: contact, conversation and event.
--   * matter_links: conversation, note, file and meeting.
--   * thread_links: both conversations and the contact, on update as well as insert (deciding a suggestion could rewrite
--     its ids).
--   * saved_views: the label.
--   * task_updates: the account and the contact on every action. The insert policy only checked the account for a
--     create, so an update or delete row could name anyone's account.

-- ---------------------------------------------------------------------------
-- account_composer
-- ---------------------------------------------------------------------------

delete from public.account_composer c
where not exists (select 1 from public.accounts a where a.id = c.account_id and a.user_id = c.user_id);

create policy "Composer settings for own accounts (insert)" on public.account_composer as restrictive for insert to authenticated
  with check (exists (select 1 from public.accounts a where a.id = account_composer.account_id and a.user_id = (select auth.uid())));
create policy "Composer settings for own accounts (update)" on public.account_composer as restrictive for update to authenticated
  with check (exists (select 1 from public.accounts a where a.id = account_composer.account_id and a.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- note_links
-- ---------------------------------------------------------------------------

create policy "Note links point at own rows (insert)" on public.note_links as restrictive for insert to authenticated
  with check (
    (contact_id is null or exists (select 1 from public.contacts c where c.id = note_links.contact_id and c.user_id = (select auth.uid())))
    and (thread_id is null or exists (select 1 from public.threads t where t.id = note_links.thread_id and t.user_id = (select auth.uid())))
    and (event_id is null or exists (select 1 from public.calendar_events e where e.id = note_links.event_id and e.user_id = (select auth.uid())))
  );
create policy "Note links point at own rows (update)" on public.note_links as restrictive for update to authenticated
  with check (
    (contact_id is null or exists (select 1 from public.contacts c where c.id = note_links.contact_id and c.user_id = (select auth.uid())))
    and (thread_id is null or exists (select 1 from public.threads t where t.id = note_links.thread_id and t.user_id = (select auth.uid())))
    and (event_id is null or exists (select 1 from public.calendar_events e where e.id = note_links.event_id and e.user_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- matter_links
-- ---------------------------------------------------------------------------

create policy "Matter links point at own rows (insert)" on public.matter_links as restrictive for insert to authenticated
  with check (
    (thread_id is null or exists (select 1 from public.threads t where t.id = matter_links.thread_id and t.user_id = (select auth.uid())))
    and (note_id is null or exists (select 1 from public.notes n where n.id = matter_links.note_id and n.user_id = (select auth.uid())))
    and (attachment_id is null or exists (select 1 from public.attachments f where f.id = matter_links.attachment_id and f.user_id = (select auth.uid())))
    and (meeting_id is null or exists (select 1 from public.meetings g where g.id = matter_links.meeting_id and g.user_id = (select auth.uid())))
  );
create policy "Matter links point at own rows (update)" on public.matter_links as restrictive for update to authenticated
  with check (
    (thread_id is null or exists (select 1 from public.threads t where t.id = matter_links.thread_id and t.user_id = (select auth.uid())))
    and (note_id is null or exists (select 1 from public.notes n where n.id = matter_links.note_id and n.user_id = (select auth.uid())))
    and (attachment_id is null or exists (select 1 from public.attachments f where f.id = matter_links.attachment_id and f.user_id = (select auth.uid())))
    and (meeting_id is null or exists (select 1 from public.meetings g where g.id = matter_links.meeting_id and g.user_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- thread_links
-- ---------------------------------------------------------------------------

create policy "Thread links point at own rows (insert)" on public.thread_links as restrictive for insert to authenticated
  with check (
    exists (select 1 from public.threads t where t.id = thread_links.thread_a and t.user_id = (select auth.uid()))
    and exists (select 1 from public.threads t where t.id = thread_links.thread_b and t.user_id = (select auth.uid()))
    and (contact_id is null or exists (select 1 from public.contacts c where c.id = thread_links.contact_id and c.user_id = (select auth.uid())))
  );
create policy "Thread links point at own rows (update)" on public.thread_links as restrictive for update to authenticated
  with check (
    exists (select 1 from public.threads t where t.id = thread_links.thread_a and t.user_id = (select auth.uid()))
    and exists (select 1 from public.threads t where t.id = thread_links.thread_b and t.user_id = (select auth.uid()))
    and (contact_id is null or exists (select 1 from public.contacts c where c.id = thread_links.contact_id and c.user_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- saved_views
-- ---------------------------------------------------------------------------

create policy "Saved views use own labels (insert)" on public.saved_views as restrictive for insert to authenticated
  with check (label_id is null or exists (select 1 from public.labels l where l.id = saved_views.label_id and l.user_id = (select auth.uid())));
create policy "Saved views use own labels (update)" on public.saved_views as restrictive for update to authenticated
  with check (label_id is null or exists (select 1 from public.labels l where l.id = saved_views.label_id and l.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- task_updates (the app only inserts; it has no update policy)
-- ---------------------------------------------------------------------------

create policy "Task updates name own rows" on public.task_updates as restrictive for insert to authenticated
  with check (
    (account_id is null or exists (select 1 from public.accounts a where a.id = task_updates.account_id and a.user_id = (select auth.uid())))
    and (contact_id is null or exists (select 1 from public.contacts c where c.id = task_updates.contact_id and c.user_id = (select auth.uid())))
  );
