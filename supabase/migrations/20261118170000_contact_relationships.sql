-- A light relationship layer on Contacts (Wave 4). Not a CRM: no stages, scores or custom fields.
--
-- 1. contacts.vip: a star. VIPs float to the top of People and triage treats their mail as at least important
--    and never as junk (apps/ai/ai/triage_signals.py reads it).
-- 2. contacts.about_note: one free-text note the user writes about a person, sealed per user in the browser
--    (FIELD.contactAbout). The draft prompt gets it as a fact the user wrote (apps/ai/ai/drafts_gather.py).
-- 3. contact_last_touch(): the newest incoming and the newest outgoing message per contact, for the status line
--    ("Waiting on you since Tuesday") and Going Quiet. Group chats, junk, newsletters, notifications and
--    conversations in the bin are left out, as in contact_summaries(). The newest of each direction is read
--    through messages_thread_idx (thread_id, sent_at), so a long conversation is not scanned whole.
-- 4. task_updates.contact_id: a follow-up reminder made from a contact. The worker stores a created task without
--    knowing the contact, and a create row may not carry a task_id (task_updates_target_check), so a trigger on
--    new tasks pairs the task with the oldest unlinked reminder of the same account and due time made in the last
--    15 minutes, and sets tasks.contact_id. If nothing matches the task simply stays unlinked.

alter table public.contacts
  add column if not exists vip boolean not null default false,
  add column if not exists about_note text check (about_note is null or length(about_note) <= 4000);

create or replace function public.contact_last_touch(p_contact uuid default null)
returns table (contact_id uuid, last_inbound_at timestamptz, last_outbound_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select tp.contact_id,
         max(x.last_in),
         max(x.last_out)
  from public.threads t
  join public.thread_participants tp on tp.thread_id = t.id
  cross join lateral (
    select (select m.sent_at from public.messages m where m.thread_id = t.id and m.direction = 'inbound' order by m.sent_at desc limit 1) as last_in,
           (select m.sent_at from public.messages m where m.thread_id = t.id and m.direction = 'outbound' order by m.sent_at desc limit 1) as last_out
  ) x
  where t.user_id = (select auth.uid())
    and t.status <> 'trash'
    and not t.is_group
    and not t.junk
    and coalesce(t.category, '') not in ('newsletter', 'notification')
    and (p_contact is null or tp.contact_id = p_contact)
  group by tp.contact_id
$$;

revoke execute on function public.contact_last_touch(uuid) from public, anon;
grant execute on function public.contact_last_touch(uuid) to authenticated;

alter table public.task_updates
  add column if not exists contact_id uuid references public.contacts (id) on delete set null,
  add column if not exists linked_at timestamptz;

create index if not exists task_updates_unlinked_idx on public.task_updates (account_id, created_at)
  where contact_id is not null and linked_at is null;

create or replace function public.link_new_task_to_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_update uuid;
  v_contact uuid;
begin
  if new.contact_id is not null then
    return null;
  end if;
  select u.id, u.contact_id into v_update, v_contact
  from public.task_updates u
  where u.action = 'create' and u.contact_id is not null and u.linked_at is null
    and u.account_id = new.account_id and u.user_id = new.user_id
    and u.due_at is not distinct from new.due_at
    and u.created_at > now() - interval '15 minutes'
  order by u.created_at
  limit 1
  for update skip locked;
  if v_update is null then
    return null;
  end if;
  -- A reminder may only point at the user's own contact.
  if exists (select 1 from public.contacts c where c.id = v_contact and c.user_id = new.user_id) then
    update public.tasks set contact_id = v_contact where id = new.id;
  end if;
  update public.task_updates set linked_at = now() where id = v_update;
  return null;
end
$$;

revoke execute on function public.link_new_task_to_contact() from public, anon, authenticated;

drop trigger if exists link_new_task_to_contact on public.tasks;
create trigger link_new_task_to_contact after insert on public.tasks
  for each row execute function public.link_new_task_to_contact();
