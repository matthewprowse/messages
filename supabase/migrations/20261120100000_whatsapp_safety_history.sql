-- WhatsApp safety and depth (Wave 6).
--  1. outbox.cold_chat and outbox.wait_reason: a WhatsApp message held back by a send limit stays queued (send_after moves to when the limit
--     lifts) and says why, so the app can show "Waiting: Daily WhatsApp Limit" instead of a failure.
--  2. message_versions: an edit or a deletion made in WhatsApp keeps what the message said before. The original is never
--     overwritten; the body is sealed exactly as it was in messages.body_text.
--  3. whatsapp_update_message keeps those versions (same signature as before) before it replaces the text, so nothing is lost.
--  4. Poll votes, WhatsApp Business labels (one way, WhatsApp to Konva).

alter table public.outbox add column wait_reason text check (wait_reason in ('daily_limit', 'new_chat_limit'));
-- Set by the worker when it takes a WhatsApp message: the message went to someone the account had never chatted with, so it
-- counts toward the stricter new chat limit.
alter table public.outbox add column cold_chat boolean not null default false;
create index outbox_whatsapp_recent_idx on public.outbox (account_id, sent_at desc) where status in ('sending', 'sent');

create table public.message_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  -- Why this text was set aside: the sender edited it, or deleted the message.
  reason text not null check (reason in ('edited', 'deleted')),
  body_text text,                          -- sealed, copied as it was in messages.body_text
  created_at timestamptz not null default now()
);

create index message_versions_message_idx on public.message_versions (message_id, created_at);
create index message_versions_user_idx on public.message_versions (user_id);

alter table public.message_versions enable row level security;

create policy "Read own message versions" on public.message_versions for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.message_versions from anon;
revoke insert, update, delete, truncate on public.message_versions from authenticated;

-- An edit or a deletion made in WhatsApp. A null body or preview leaves it as it is; p_meta is merged into provider_meta.
-- Before an edit (meta.edited) or a deletion (meta.deleted) replaces the text, the text as it was is kept as a version, so the
-- original is never lost; the message itself then carries the new text, or the worker's "deleted" notice, so search, drafts and
-- the AI never read a deleted message. meta.edit_ts (ms) makes a redelivered edit a no-op.
-- Returns false when the message is not stored.
create or replace function public.whatsapp_update_message(
  p_account_id uuid, p_provider_message_id text, p_body text, p_preview text, p_meta jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_msg record;
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_deleting boolean := coalesce((v_meta->>'deleted')::boolean, false);
  v_editing boolean := coalesce((v_meta->>'edited')::boolean, false);
begin
  select m.id, m.user_id, m.thread_id, m.body_text, m.provider_meta into v_msg
  from public.messages m
  where m.account_id = p_account_id and m.provider_message_id = p_provider_message_id
  for update;
  if not found then
    return false;
  end if;

  if v_deleting and coalesce((v_msg.provider_meta->>'deleted')::boolean, false) then
    return true;
  end if;
  if v_editing and v_meta ? 'edit_ts'
     and coalesce((v_msg.provider_meta->>'edit_ts')::bigint, 0) >= (v_meta->>'edit_ts')::bigint then
    return true;
  end if;

  if (v_deleting or v_editing) and v_msg.body_text is not null then
    insert into public.message_versions (user_id, message_id, reason, body_text)
    values (v_msg.user_id, v_msg.id, case when v_deleting then 'deleted' else 'edited' end, v_msg.body_text);
  end if;

  update public.messages m
  set body_text = coalesce(p_body, m.body_text),
      preview = coalesce(p_preview, m.preview),
      provider_meta = m.provider_meta || v_meta
  where m.id = v_msg.id;

  perform public.refresh_thread(v_msg.thread_id);
  return true;
end;
$$;

-- A vote on a poll, kept on the poll message as provider_meta.poll_votes {"<who>": [option positions]}. A new vote by the
-- same person replaces their old one. Positions, not option text, so nothing readable is stored here.
create or replace function public.whatsapp_poll_vote(
  p_account_id uuid, p_provider_message_id text, p_voter text, p_selected integer[]
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.messages m
  set provider_meta = jsonb_set(
    m.provider_meta, '{poll_votes}',
    coalesce(m.provider_meta->'poll_votes', '{}'::jsonb) || jsonb_build_object(p_voter, to_jsonb(coalesce(p_selected, '{}'::integer[]))),
    true
  )
  where m.account_id = p_account_id and m.provider_message_id = p_provider_message_id
  returning m.id into v_id;
  return v_id is not null;
end;
$$;

-- WhatsApp Business labels. Where a label came from, so a sync updates it instead of adding another.
alter table public.labels add column wa_account_id uuid references public.accounts (id) on delete cascade;
alter table public.labels add column wa_label_id text;
create unique index labels_whatsapp_idx on public.labels (wa_account_id, wa_label_id) where wa_account_id is not null;

-- A Business label created, renamed, recoloured or deleted in WhatsApp. p_name is sealed (field "name").
create or replace function public.whatsapp_label(
  p_account_id uuid, p_wa_label_id text, p_name text, p_color text, p_deleted boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_id uuid;
begin
  select a.user_id into v_user from public.accounts a where a.id = p_account_id;
  if v_user is null then
    raise exception 'unknown account %', p_account_id using errcode = 'P0002';
  end if;
  if p_deleted then
    delete from public.labels where wa_account_id = p_account_id and wa_label_id = p_wa_label_id;
    return null;
  end if;
  insert into public.labels (user_id, name, color, wa_account_id, wa_label_id)
  values (v_user, p_name, case when p_color in ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink') then p_color else 'gray' end, p_account_id, p_wa_label_id)
  on conflict (wa_account_id, wa_label_id) where wa_account_id is not null
  do update set name = excluded.name, color = excluded.color
  returning id into v_id;
  return v_id;
end;
$$;

-- A Business label put on, or taken off, a chat. The chat is found by its indexes (a number's or a privacy ID's).
-- Returns false when the chat or label is not stored yet.
create or replace function public.whatsapp_label_chat(
  p_account_id uuid, p_wa_label_id text, p_chat_indexes text[], p_add boolean
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_label uuid;
  v_thread uuid;
  v_user uuid;
begin
  select l.id, l.user_id into v_label, v_user from public.labels l where l.wa_account_id = p_account_id and l.wa_label_id = p_wa_label_id;
  select t.id into v_thread from public.threads t where t.account_id = p_account_id and t.provider_thread_index = any (p_chat_indexes) limit 1;
  if v_label is null or v_thread is null then
    return false;
  end if;
  if p_add then
    insert into public.thread_labels (thread_id, label_id, user_id) values (v_thread, v_label, v_user) on conflict do nothing;
  else
    delete from public.thread_labels where thread_id = v_thread and label_id = v_label;
  end if;
  return true;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.whatsapp_poll_vote(uuid, text, text, integer[])',
    'public.whatsapp_label(uuid, text, text, text, boolean)',
    'public.whatsapp_label_chat(uuid, text, text[], boolean)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
