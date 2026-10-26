-- Whether a conversation's latest message is yours. Once you have answered, a conversation does not need
-- you until they write again, but its priority and category stay as the AI set them, so the Summary kept
-- listing answered conversations under Urgent and Important and Updates. Kept up to date as messages are
-- stored, moved or removed, from this app or from your phone.
alter table public.threads add column last_from_me boolean not null default false;

create or replace function public.refresh_thread_last_from_me(p_thread_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.threads t
  set last_from_me = s.from_me
  from (
    select coalesce((
      select m.direction = 'outbound' from public.messages m
      where m.thread_id = p_thread_id
      order by m.sent_at desc
      limit 1
    ), false) as from_me
  ) s
  where t.id = p_thread_id and t.last_from_me is distinct from s.from_me;
$$;

create or replace function public.thread_last_from_me_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.refresh_thread_last_from_me(old.thread_id);
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.thread_id is distinct from old.thread_id or new.sent_at is distinct from old.sent_at) then
    perform public.refresh_thread_last_from_me(new.thread_id);
  end if;
  return null;
end;
$$;

create trigger messages_thread_last_from_me
  after insert or delete or update of thread_id, sent_at on public.messages
  for each row
  execute function public.thread_last_from_me_on_message();

revoke execute on function public.refresh_thread_last_from_me(uuid) from public, anon, authenticated;
revoke execute on function public.thread_last_from_me_on_message() from public, anon, authenticated;

update public.threads t
set last_from_me = true
from (
  select distinct on (m.thread_id) m.thread_id, m.direction
  from public.messages m
  order by m.thread_id, m.sent_at desc
) s
where t.id = s.thread_id and s.direction = 'outbound';
