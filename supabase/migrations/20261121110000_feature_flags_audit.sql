-- Owner operations, part 1 (Wave 7): feature flags and kill switches, the admin settings, and the audit log of admin actions.
--
-- 1. feature_flags: key, enabled, an optional list of users. enabled means the switch is thrown (the thing is paused or
--    disabled). An empty list means everyone; a list limits the switch to those people. The sync worker and the AI worker
--    read it with the service role and cache it for a few seconds; the web app asks feature_flag_state(), which answers for
--    the signed-in person only (it never shows another person's id). The owner edits through admin_set_flag, which only
--    changes the seeded keys. A worker that cannot read the table behaves as if every switch were off.
-- 2. admin_settings: numbers the owner sets in Admin (the daily AI spend that raises an alert).
-- 3. admin_audit: who changed what in Admin, with the old and new values. Written by triggers, so no screen can forget to.
--    Values are numbers, flags and ids only: never an email, a name or message text. Changes made with the service role
--    (no signed-in person) are not admin actions and are not logged.
-- Run once; the tables are new.

-- 1. Flags
create table public.feature_flags (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  enabled     boolean     not null default false,
  user_ids    uuid[]      not null default '{}',
  description text        not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from public, anon, authenticated;
grant select on public.feature_flags to authenticated;
grant select on public.feature_flags to service_role;
create policy "Owner reads feature flags" on public.feature_flags for select to authenticated using (public.is_analytics_owner());

insert into public.feature_flags (key, description) values
  ('pause_all_ai', 'Stops every Gemini call. Each feature is paused as if its budget were spent.'),
  ('pause_predrafts', 'Stops drafts written ahead of time for new mail. Drafts people ask for still work.'),
  ('pause_documents', 'Stops reading documents and attachments into cards.'),
  ('pause_automations', 'Stops automation previews and runs that need the AI.'),
  ('disable_connector_instagram', 'Stops every Instagram connector. Accounts stay connected and start again when this is off.'),
  ('disable_connector_linkedin', 'Stops every LinkedIn connector. Accounts stay connected and start again when this is off.'),
  ('disable_sends', 'Holds every queued reply and message. Nothing is sent until this is off; Undo still works.')
on conflict (key) do nothing;

-- What the signed-in person's flags are, as {key: switched on for me}. Any signed-in person may ask; it shows no ids.
create function public.feature_flag_state() returns jsonb
  language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(f.key, f.enabled and (cardinality(f.user_ids) = 0 or (select auth.uid()) = any (f.user_ids))), '{}'::jsonb)
  from public.feature_flags f
$$;
revoke execute on function public.feature_flag_state() from public, anon;
grant execute on function public.feature_flag_state() to authenticated;

-- The owner's list: each flag with the emails (the identifier AI Usage already shows) of the people it is limited to.
create function public.admin_feature_flags()
returns table (key text, enabled boolean, description text, emails text[], updated_at timestamptz)
  language sql stable security definer set search_path = ''
as $$
  select f.key, f.enabled, f.description,
         coalesce((select array_agg(u.email::text order by u.email) from auth.users u where u.id = any (f.user_ids)), '{}'),
         f.updated_at
  from public.feature_flags f
  where public.is_analytics_owner()
  order by f.key
$$;
revoke execute on function public.admin_feature_flags() from public, anon;
grant execute on function public.admin_feature_flags() to authenticated;

-- Throws or clears a switch. p_emails null leaves the people list alone; an empty list means everyone; otherwise every
-- email must belong to a person, so a typo cannot quietly limit a switch to nobody.
create function public.admin_set_flag(p_key text, p_enabled boolean, p_emails text[] default null) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if not public.is_analytics_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  if p_emails is not null then
    select coalesce(array_agg(u.id), '{}') into v_ids
    from auth.users u where lower(u.email) in (select lower(btrim(e)) from unnest(p_emails) e);
    if cardinality(v_ids) <> (select count(distinct lower(btrim(e))) from unnest(p_emails) e) then
      raise exception 'an email does not belong to anyone' using errcode = '22023';
    end if;
  end if;
  update public.feature_flags
     set enabled = p_enabled, user_ids = coalesce(v_ids, user_ids), updated_at = now(), updated_by = (select auth.uid())
   where key = p_key;
  if not found then
    raise exception 'unknown flag' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.admin_set_flag(text, boolean, text[]) from public, anon;
grant execute on function public.admin_set_flag(text, boolean, text[]) to authenticated;

-- 2. Settings
create table public.admin_settings (
  key        text primary key,
  value      numeric     not null check (value >= 0),
  updated_at timestamptz not null default now()
);
alter table public.admin_settings enable row level security;
revoke all on public.admin_settings from public, anon, authenticated;
grant select on public.admin_settings to authenticated;
create policy "Owner reads admin settings" on public.admin_settings for select to authenticated using (public.is_analytics_owner());
insert into public.admin_settings (key, value) values ('daily_ai_alert_usd', 20) on conflict (key) do nothing;

create function public.admin_set_setting(p_key text, p_value numeric) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_analytics_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  update public.admin_settings set value = p_value, updated_at = now() where key = p_key;
  if not found then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.admin_set_setting(text, numeric) from public, anon;
grant execute on function public.admin_set_setting(text, numeric) to authenticated;

-- 3. Audit log
create table public.admin_audit (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid,
  action    text  not null,
  target    text,
  old_value jsonb,
  new_value jsonb
);
create index admin_audit_at_idx on public.admin_audit (at desc);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from public, anon, authenticated;
grant select on public.admin_audit to authenticated;
create policy "Owner reads the admin audit" on public.admin_audit for select to authenticated using (public.is_analytics_owner());

create function public.admin_audit_write(p_action text, p_target text, p_old jsonb, p_new jsonb) returns void
  language sql security definer set search_path = ''
as $$
  insert into public.admin_audit (actor, action, target, old_value, new_value) values ((select auth.uid()), p_action, p_target, p_old, p_new)
$$;
revoke execute on function public.admin_audit_write(text, text, jsonb, jsonb) from public, anon, authenticated;

create function public.admin_audit_log(p_limit integer default 100)
returns table (id bigint, at timestamptz, actor_email text, action text, target text, old_value jsonb, new_value jsonb)
  language sql stable security definer set search_path = ''
as $$
  select a.id, a.at, (select u.email::text from auth.users u where u.id = a.actor), a.action, a.target, a.old_value, a.new_value
  from public.admin_audit a
  where public.is_analytics_owner()
  order by a.at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;
revoke execute on function public.admin_audit_log(integer) from public, anon;
grant execute on function public.admin_audit_log(integer) to authenticated;

-- Triggers. Each logs only when a signed-in person made the change.
create function public.audit_ai_budget() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    perform public.admin_audit_write('budget_saved', 'ai_budget', to_jsonb(old) - 'updated_at', to_jsonb(new) - 'updated_at');
  end if;
  return new;
end;
$$;
create trigger audit_ai_budget after update on public.ai_budget for each row execute function public.audit_ai_budget();

create function public.audit_flag() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and (new.enabled is distinct from old.enabled or new.user_ids is distinct from old.user_ids) then
    perform public.admin_audit_write('flag_changed', new.key,
      jsonb_build_object('enabled', old.enabled, 'people', cardinality(old.user_ids)),
      jsonb_build_object('enabled', new.enabled, 'people', cardinality(new.user_ids)));
  end if;
  return new;
end;
$$;
create trigger audit_flag after update on public.feature_flags for each row execute function public.audit_flag();

create function public.audit_setting() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.value is distinct from old.value then
    perform public.admin_audit_write('setting_changed', new.key, jsonb_build_object('value', old.value), jsonb_build_object('value', new.value));
  end if;
  return new;
end;
$$;
create trigger audit_setting after update on public.admin_settings for each row execute function public.audit_setting();

-- Approvals: the request's kind and status only. Its email and company are not copied.
create function public.audit_waitlist() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.status is distinct from old.status then
    perform public.admin_audit_write('request_decided', new.id::text,
      jsonb_build_object('status', old.status, 'kind', old.kind), jsonb_build_object('status', new.status, 'kind', new.kind));
  end if;
  return new;
end;
$$;
create trigger audit_waitlist after update on public.waitlist for each row execute function public.audit_waitlist();

-- Seats: the team's id and the seat count. Its name is not copied.
create function public.audit_workspace() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.admin_audit_write('team_created', new.id::text, null, jsonb_build_object('seats', new.seats));
  elsif new.seats is distinct from old.seats then
    perform public.admin_audit_write('seats_changed', new.id::text, jsonb_build_object('seats', old.seats), jsonb_build_object('seats', new.seats));
  end if;
  return new;
end;
$$;
create trigger audit_workspace after insert or update on public.workspaces for each row execute function public.audit_workspace();

revoke execute on function public.audit_ai_budget(), public.audit_flag(), public.audit_setting(), public.audit_waitlist(), public.audit_workspace() from public, anon, authenticated;
