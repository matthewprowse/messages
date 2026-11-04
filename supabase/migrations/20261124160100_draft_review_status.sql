-- Drafts gain the status 'review': a pre-draft that states an amount, account, phone number or address only the other
-- side's newest message gives (apps/ai/ai/drafts_facts.py held_for_review). It used to be stored 'expired' with the
-- error "held_for_review", so nobody ever saw it. Now the app shows it marked as one to check before use, beside the
-- live ('active') draft, which it never replaces.
--
-- It lives as an 'active' draft does: a newer message in the conversation expires it (expire_auto_drafts, below), a
-- newer draft replaces it (the AI worker), and the retention job keeps it as it keeps 'active' ones (it deletes only
-- revised, expired, sent and discarded drafts). Learning never reads it (signals.py reads active, sent and discarded).
--
-- The status list is 20261029100000_draft_revisions.sql's plus 'review'. expire_auto_drafts is exactly
-- 20261028110900_pre_drafting.sql's (the only migration that defines it) with 'review' beside 'pending' and 'active':
-- same security definer, search_path and grants.

alter table public.drafts drop constraint drafts_status_check;
alter table public.drafts add constraint drafts_status_check
  check (status in ('pending', 'active', 'sent', 'discarded', 'failed', 'expired', 'revised', 'review'));

create or replace function public.expire_auto_drafts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.drafts d
  set status = 'expired', updated_at = now()
  from public.messages answered
  where d.auto and d.status in ('pending', 'active', 'review') and answered.id = d.for_message_id
    and exists (select 1 from inserted i where i.thread_id = d.thread_id and i.sent_at > answered.sent_at);
  return null;
end;
$$;

revoke execute on function public.expire_auto_drafts() from public, anon, authenticated;

-- The app looks up a conversation's drafts to check as it does its live one.
create index if not exists drafts_review_thread_idx on public.drafts (thread_id) where status = 'review';
