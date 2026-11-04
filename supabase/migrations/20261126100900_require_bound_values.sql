-- APPLY ONLY AFTER THE RE-SEAL (docs/RUNBOOK.md, Binding Values To Their Place, step 7). Not applied with the other
-- 20261126 migrations.
--
-- The columns that drive an action (what is sent, and what is written to a calendar or task list) may hold only values
-- bound to their row ("e2:", packages/crypto/src/bound.ts) from now on: a plain value, a legacy "e1:" one or a team value
-- is refused at the database as it already is by the workers (REQUIRE_BOUND_FIELDS). Only a queued row is checked (it is
-- what a worker acts on): a row that is sending, sent or done, written before, can still be updated by the workers. NOT
-- VALID: rows already there are not checked until they change. Local development that runs with encryption off writes
-- plain text here, so it must not have this migration.
--
-- It refuses to apply while it would break writes: unless queued rows already carry bound values and none waiting is
-- legacy or plain (SEAL_BOUND_FIELDS on everywhere, and fields:bind or keys:rekey has run), it stops with an error and
-- changes nothing. Apply it again once that is true.

create or replace function public.is_bound_value(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_value is null or p_value ~ '^e2:[A-Za-z0-9+/]+={0,2}$' $$;

create or replace function public.all_bound_values(p_values text[])
returns boolean
language sql
immutable
set search_path = ''
as $$ select coalesce(bool_and(public.is_bound_value(v) and v is not null), true) from unnest(p_values) as v $$;

-- The check constraints run them as the inserting user.
revoke execute on function public.is_bound_value(text) from public, anon;
grant execute on function public.is_bound_value(text) to authenticated, service_role;
revoke execute on function public.all_bound_values(text[]) from public, anon;
grant execute on function public.all_bound_values(text[]) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from public.outbox where body ~ '^e2:' and created_at > now() - interval '7 days') then
    raise exception 'Not yet: no outbox row from the last week is bound. Turn on SEAL_BOUND_FIELDS and NEXT_PUBLIC_SEAL_BOUND_FIELDS first.';
  end if;
  if exists (
    select 1 from public.outbox
    where status = 'queued' and not (public.is_bound_value(body) and public.is_bound_value(subject) and public.is_bound_value(from_address)
      and public.all_bound_values(to_addresses) and public.all_bound_values(cc_addresses) and public.all_bound_values(bcc_addresses))
  ) or exists (
    select 1 from public.calendar_outbox
    where status = 'queued' and not (public.is_bound_value(title) and public.is_bound_value(description) and public.is_bound_value(location) and public.all_bound_values(attendees))
  ) or exists (
    select 1 from public.task_updates where status = 'queued' and not (public.is_bound_value(title) and public.is_bound_value(notes))
  ) then
    raise exception 'Not yet: queued rows still hold unbound values. Run pnpm --filter worker fields:bind --all --apply first.';
  end if;
end;
$$;

alter table public.outbox add constraint outbox_bound_values check (
  status <> 'queued' or body ~ '^e2:' and public.is_bound_value(subject) and public.is_bound_value(from_address)
  and public.all_bound_values(to_addresses) and public.all_bound_values(cc_addresses) and public.all_bound_values(bcc_addresses)
) not valid;

alter table public.outbox_attachments add constraint outbox_attachments_bound_values check (filename ~ '^e2:') not valid;

alter table public.calendar_outbox add constraint calendar_outbox_bound_values check (
  status <> 'queued' or title ~ '^e2:' and public.is_bound_value(description) and public.is_bound_value(location) and public.all_bound_values(attendees)
) not valid;

alter table public.calendar_updates add constraint calendar_updates_bound_values check (
  status <> 'queued' or public.is_bound_value(title) and public.is_bound_value(description) and public.is_bound_value(location)
  and (attendees is null or public.all_bound_values(attendees))
) not valid;

alter table public.task_updates add constraint task_updates_bound_values check (status <> 'queued' or public.is_bound_value(title) and public.is_bound_value(notes)) not valid;
