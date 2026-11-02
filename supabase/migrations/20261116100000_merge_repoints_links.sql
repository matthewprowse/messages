-- merge_contacts and undo_merge now carry the four later links to a contact along with the merge.
--
-- Until now a merge repointed only identities, participants, messages, draft_outcomes and style_rules. These
-- columns reference contacts(id) with "on delete set null" and were added after the merge code, so deleting the
-- merged contact silently emptied them and Undo could not bring them back:
--   tasks.contact_id, meeting_participants.contact_id, drafts.contact_id, threads.last_sender_contact_id.
-- The merge now moves each to the kept contact and records the ids in contact_merges.moved (tasks[],
-- meeting_participants[], drafts[], threads_last_sender[]); Undo moves exactly those rows back to the restored
-- contact. Merges made before this migration have no such keys, so Undo leaves them alone (coalesce to []).
--
-- Both functions are long and were patched in place before (20261025000700), so their live definitions are
-- patched here the same way instead of copied: the signature, security definer, search_path and grants stay as
-- they are. Each patch fails loudly if its anchor is missing. delete_contact needs no change: it deletes the
-- person, and the set-null foreign keys already let go of these four columns.

create function pg_temp.patched(p_def text, p_old text, p_new text)
returns text
language plpgsql
as $$
begin
  if position(p_old in p_def) = 0 then
    raise exception 'patch target not found: %', left(p_old, 80);
  end if;
  return replace(p_def, p_old, p_new);
end;
$$;

-- merge_contacts: after the style rules move, move the four links and record them.
do $$
declare
  v_def text := pg_get_functiondef('public.merge_contacts'::regproc);
begin
  v_def := pg_temp.patched(v_def,
'  v_moved := v_moved || jsonb_build_object(''style_rules'', v_ids);
',
'  v_moved := v_moved || jsonb_build_object(''style_rules'', v_ids);

  with u as (
    update public.tasks t set contact_id = p_keep
    where t.contact_id = p_merge and t.user_id = v_user
    returning t.id
  )
  select coalesce(jsonb_agg(u.id), ''[]''::jsonb) into v_ids from u;
  v_moved := v_moved || jsonb_build_object(''tasks'', v_ids);

  with u as (
    update public.meeting_participants mp set contact_id = p_keep
    where mp.contact_id = p_merge and mp.user_id = v_user
    returning mp.id
  )
  select coalesce(jsonb_agg(u.id), ''[]''::jsonb) into v_ids from u;
  v_moved := v_moved || jsonb_build_object(''meeting_participants'', v_ids);

  with u as (
    update public.drafts d set contact_id = p_keep
    where d.contact_id = p_merge and d.user_id = v_user
    returning d.id
  )
  select coalesce(jsonb_agg(u.id), ''[]''::jsonb) into v_ids from u;
  v_moved := v_moved || jsonb_build_object(''drafts'', v_ids);

  with u as (
    update public.threads th set last_sender_contact_id = p_keep
    where th.last_sender_contact_id = p_merge and th.user_id = v_user
    returning th.id
  )
  select coalesce(jsonb_agg(u.id), ''[]''::jsonb) into v_ids from u;
  v_moved := v_moved || jsonb_build_object(''threads_last_sender'', v_ids);
');
  execute v_def;
end;
$$;

-- undo_merge: after the style rules go back, send back the rows recorded above that still point at the kept
-- contact (one the user relinked since stays where they put it).
do $$
declare
  v_def text := pg_get_functiondef('public.undo_merge'::regproc);
begin
  v_def := pg_temp.patched(v_def,
'    and r.id in (select jsonb_array_elements_text(v_moved -> ''style_rules'')::uuid);
',
'    and r.id in (select jsonb_array_elements_text(v_moved -> ''style_rules'')::uuid);

  update public.tasks t set contact_id = v_restored
  where t.contact_id = v_keep.id
    and t.id in (select jsonb_array_elements_text(coalesce(v_moved -> ''tasks'', ''[]''::jsonb))::uuid);

  update public.meeting_participants mp set contact_id = v_restored
  where mp.contact_id = v_keep.id
    and mp.id in (select jsonb_array_elements_text(coalesce(v_moved -> ''meeting_participants'', ''[]''::jsonb))::uuid);

  update public.drafts d set contact_id = v_restored
  where d.contact_id = v_keep.id
    and d.id in (select jsonb_array_elements_text(coalesce(v_moved -> ''drafts'', ''[]''::jsonb))::uuid);

  update public.threads th set last_sender_contact_id = v_restored
  where th.last_sender_contact_id = v_keep.id
    and th.id in (select jsonb_array_elements_text(coalesce(v_moved -> ''threads_last_sender'', ''[]''::jsonb))::uuid);
');
  execute v_def;
end;
$$;

-- Same grants as before, restated because the definitions were replaced.
revoke execute on function public.merge_contacts(uuid, uuid, text, boolean, uuid) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid, text, boolean, uuid) to authenticated, service_role;
revoke execute on function public.undo_merge(uuid, uuid) from public, anon;
grant execute on function public.undo_merge(uuid, uuid) to authenticated, service_role;
