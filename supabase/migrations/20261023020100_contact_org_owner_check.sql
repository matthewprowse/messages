-- The organization trigger runs with owner rights, so it must only ever touch a contact that belongs to
-- the same user as the new identity.
create or replace function public.assign_contact_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if exists (
    select 1 from public.contacts c
    where c.id = new.contact_id and c.user_id = new.user_id and c.organization_id is null
  ) then
    v_org := public.organization_for_address(new.user_id, new.value);
    if v_org is not null then
      update public.contacts set organization_id = v_org
      where id = new.contact_id and user_id = new.user_id and organization_id is null;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.assign_contact_organization() from public, anon, authenticated;

-- An identity can only point at one of your own contacts.
create policy "Identities point at own contacts" on public.contact_identities
  as restrictive
  for insert
  to authenticated
  with check (exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = (select auth.uid())));

create policy "Identities stay on own contacts" on public.contact_identities
  as restrictive
  for update
  to authenticated
  with check (exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = (select auth.uid())));
