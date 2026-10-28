-- Files and file names of shared chats (docs/PLAN.md, Teams, step 3). Not applied by whoever wrote it: apply by hand.
--
-- A shared chat's messages are re-sealed under the team key, but an attachment's name was left under the agent's key and
-- its bytes were sealed with the agent's data key, so a teammate saw a blank name and could not open the file. Now:
--
--   * The name moves to the team key like any other shared text (attachments.filename, t1:). share_write may set it.
--   * A sealed file gets a COPY sealed under the team's current key at team/<workspace>/<attachment id> in the same
--     bucket. attachments.team_path says where, team_key_version which key version sealed it, so a key rotation finds
--     the copies it has to seal again (apps/worker/src/share/rotate.ts). The agent's own object stays where it is.
--     A file stored unsealed (encryption off) needs no copy: readers use storage_path as before.
--   * Moving the chat back to personal clears team_path and the worker deletes the team object.
--   * Team members read a team object under the same rule as the agent's object: the file's message is readable by them.

alter table public.attachments
  add column team_path text check (team_path is null or length(team_path) <= 200),
  add column team_key_version integer check (team_key_version is null or team_key_version > 0);

-- Rotation looks for copies sealed under an older version, a workspace at a time.
create index attachments_team_files_idx on public.attachments (workspace_id, id) where team_path is not null;

create policy "Read shared attachment team files" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.attachments a
      where a.team_path = name and a.workspace_id is not null and public.can_read_message(a.message_id, a.workspace_id)
    )
  );

-- A file whose bytes are stored after the chat was shared (the worker saves them later than the message) needs its
-- team copy, so saving it queues a follow-up. The insert trigger already covers a new row.
create trigger attachments_share_saved after update of storage_path, sealed on public.attachments
  for each row when (new.workspace_id is not null and new.storage_path is not null and new.sealed and new.team_path is null)
  execute function public.share_followup_on_attachment();

-- What still needs moving: the workspace, a name not yet under the team key, a sealed file without its team copy.
-- Going back: the workspace, a name under the team key, a team copy.
create or replace function public.share_pending_attachments(p_thread uuid, p_direction text, p_after uuid, p_limit integer)
  returns setof public.attachments
  language sql stable set search_path = ''
as $$
  select a.* from public.attachments a
  join public.messages m on m.id = a.message_id
  join public.threads t on t.id = m.thread_id
  where m.thread_id = p_thread and (p_after is null or a.id > p_after)
    and case p_direction
      when 'to_work' then t.workspace_id is not null and (t.share_from is null or m.sent_at >= t.share_from)
                          and (a.workspace_id is distinct from t.workspace_id
                               or public.needs_team_seal(a.filename)
                               or (a.sealed and a.storage_path is not null and a.team_path is null))
      else t.workspace_id is null and (a.workspace_id is not null or a.filename like 't1:%' or a.team_path is not null)
    end
  order by a.id limit p_limit
$$;

revoke execute on function public.share_pending_attachments(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.share_pending_attachments(uuid, text, uuid, integer) to service_role;

-- share_write as in 20261101120000_shared_chats.sql with one change: attachments may also set filename, team_path and
-- team_key_version. Rotation uses it for the names of a workspace's files; the bytes it seals again itself.
create or replace function public.share_write(p_thread uuid, p_workspace uuid, p_table text, p_rows jsonb) returns integer
  language plpgsql set search_path = ''
as $$
declare
  v_columns text[] := case p_table
    when 'threads' then array['subject', 'last_message_preview', 'summary', 'share_label']
    when 'messages' then array['subject', 'preview', 'body_text', 'body_html', 'list_unsubscribe', 'body_marks', 'transcript', 'sender_address', 'to_addresses', 'provider_meta', 'workspace_id']
    when 'message_ai' then array['summary', 'reply_choices', 'workspace_id']
    when 'attachments' then array['workspace_id', 'filename', 'team_path', 'team_key_version']
  end;
  v_key text := case p_table when 'message_ai' then 'message_id' else 'id' end;
  v_scope text := case p_table
    when 'threads' then 't.id = $2'
    when 'messages' then 't.thread_id = $2'
    else 'exists (select 1 from public.messages m where m.id = t.message_id and m.thread_id = $2)'
  end;
  v_row jsonb;
  v_set text;
  v_match text;
  v_count integer := 0;
  v_done integer;
begin
  if v_columns is null then
    raise exception 'no shared content in %', p_table;
  end if;
  if not exists (select 1 from public.threads th where th.id = p_thread and th.workspace_id is not distinct from p_workspace) then
    return 0;
  end if;
  perform set_config('share.writing', 'on', true);
  perform set_config('messages.keep_address_index', 'on', true);
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if (v_row->'set') ? 'workspace_id' and (v_row->'set'->>'workspace_id') is not null
       and (v_row->'set'->>'workspace_id')::uuid is distinct from p_workspace then
      raise exception 'a row can only be placed in the workspace the job is for';
    end if;
    select string_agg(format('%I = (jsonb_populate_record(null::public.%I, $1->''set'')).%I', k, p_table, k), ', '),
           string_agg(format('coalesce(to_jsonb(t.%I), ''null''::jsonb) = coalesce($1->''expect''->%L, ''null''::jsonb)', k, k), ' and ')
    into v_set, v_match
    from jsonb_object_keys(v_row->'set') as k
    where k = any (v_columns);
    if v_set is null then
      continue;
    end if;
    execute format('update public.%I t set %s where t.%I = ($1->>''id'')::uuid and %s and %s', p_table, v_set, v_key, v_scope, v_match)
      using v_row, p_thread;
    get diagnostics v_done = row_count;
    v_count := v_count + v_done;
  end loop;
  perform set_config('share.writing', 'off', true);
  perform set_config('messages.keep_address_index', 'off', true);
  return v_count;
end;
$$;
revoke execute on function public.share_write(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.share_write(uuid, uuid, text, jsonb) to service_role;
