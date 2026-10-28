-- The worker claims a mail action by setting status 'working' (20261108100700) but nothing records when, so
-- recovering a stuck claim could only go by created_at. claimed_at is that time. A trigger sets it whenever a row
-- moves into 'working' from another status and leaves every other column alone; the worker does not have to send it.
-- It is cleared when the row leaves 'working' by being put back to 'queued', so a later claim starts a new clock.
-- The column is nullable with no default (catalog only change, instant). The trigger only runs on updates of status.
-- Rows already 'working' when this runs keep a null claimed_at; recovery should fall back to created_at for them.

alter table public.mail_actions add column if not exists claimed_at timestamptz;

create or replace function public.mail_actions_set_claimed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'working' and old.status is distinct from 'working' then
    new.claimed_at := now();
  elsif new.status = 'queued' and old.status = 'working' then
    new.claimed_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.mail_actions_set_claimed_at() from public, anon, authenticated;

drop trigger if exists mail_actions_claimed_at on public.mail_actions;
create trigger mail_actions_claimed_at before update of status on public.mail_actions
  for each row execute function public.mail_actions_set_claimed_at();
