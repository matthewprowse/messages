-- accept_invite matched the invite to the signed-in person's address but did not check that the address was
-- confirmed, so someone could sign up with another person's address, never confirm it, and use an invite sent
-- there. The owner check (is_analytics_owner) already requires a confirmed address; this does the same here.
-- The function is the one from 20261101100000_workspaces.sql, unchanged except for the added
-- "and u.email_confirmed_at is not null". An unconfirmed address now finds no email, so the existing
-- "sent to a different email address" error is raised. invite_preview never looks up the signed-in user
-- (it only reads the invite by its token), so it needs no change. Grants stay as they were (create or replace
-- keeps them); they are repeated so the file is complete on its own.
create or replace function public.accept_invite(p_token text) returns uuid
  language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_invite public.workspace_invites;
  v_workspace public.workspaces;
  v_email text;
begin
  if v_user is null then
    raise exception 'Sign in to join a team' using errcode = '28000';
  end if;
  select i.* into v_invite from public.workspace_invites i
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
    and i.accepted_at is null and i.expires_at > now()
  for update;
  if not found then
    raise exception 'This invite link is not valid, or it has expired' using errcode = 'P0002';
  end if;
  select lower(u.email) into v_email from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;
  if v_email is distinct from v_invite.email then
    raise exception 'This invite was sent to a different email address. Sign in with the address it was sent to' using errcode = '42501';
  end if;

  select w.* into v_workspace from public.workspaces w where w.id = v_invite.workspace_id for update;
  if exists (select 1 from public.workspace_members m where m.user_id = v_user and m.status = 'active') then
    raise exception 'You already belong to a team. Leave it before joining another' using errcode = '23505';
  end if;
  if v_invite.role = 'compliance' and not v_workspace.strict_sharing then
    raise exception 'This invite is no longer valid' using errcode = '22023';
  end if;
  if v_invite.role = 'owner' and v_workspace.owner_id is not null then
    raise exception 'This team already has an owner' using errcode = '22023';
  end if;
  if (select count(*) from public.workspace_members m where m.workspace_id = v_workspace.id and m.status = 'active') >= v_workspace.seats then
    raise exception 'This team has no free seats' using errcode = '22023';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status, joined_at)
  values (v_workspace.id, v_user, v_invite.role, 'active', now())
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, status = 'active', joined_at = now(), left_at = null;
  if v_invite.role = 'owner' then
    update public.workspaces set owner_id = v_user where id = v_workspace.id;
  end if;
  update public.workspace_invites set accepted_at = now() where id = v_invite.id;
  return v_workspace.id;
end;
$$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
