-- Makes the changelog readable by every signed-in user, published entries only (drafts stay owner-only: the owner's select
-- policy is untouched, and Postgres ORs the two). published_at is when an entry was last made public; the What's New dialog
-- compares it with what the user last saw. A trigger sets it, so no client has to remember to.

alter table public.updates add column published_at timestamptz;

-- Entries already published get their last edit time as the best available answer.
update public.updates set published_at = updated_at where published;

create function public.updates_set_published_at() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    new.published_at := now();
  elsif not new.published then
    new.published_at := null;
  end if;
  return new;
end
$$;

create trigger set_published_at before insert or update of published on public.updates
  for each row execute function public.updates_set_published_at();

create policy "Everyone reads published updates" on public.updates for select to authenticated using (published);
