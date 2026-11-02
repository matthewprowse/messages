-- merge_contacts and undo_merge now carry a contact's star, About note and lead source along with the merge.
--
-- contacts.vip (the star), contacts.about_note and contacts.lead_source were added after the merge code
-- (20261118170000, 20261120110000), so merging a contact into another threw them away with the deleted row. Now:
--   * vip: starred if either was starred (OR).
--   * about_note, lead_source: the kept contact's value when it has one, else the merged contact's. relationship,
--     company and role already worked this way and are untouched.
--   * When both contacts have an About note the merged contact's is not lost: contact_merges.merged_snapshot already
--     holds the whole merged row as it was, sealed, and Undo inserts that row back, so the note returns with it.
--     (Both notes are sealed separately under the same user key, so neither is joined into the other: that would
--     need opening them, and the database never can.)
--   * The three columns are added to the list of the kept contact's fields the merge records as kept_before and
--     kept_after, so Undo puts them back exactly as they were unless they were changed since. Undo's restore
--     statement lists its columns, so it gets the same three.
-- Merges made before this migration recorded no change to these columns, so Undo leaves the kept contact's three
-- alone for them (the keys are absent from kept_before), and still restores the merged contact from its snapshot.
--
-- Both functions are long, so their live definitions are patched here the same way 20261116100000 did instead of
-- copied: the signature, security definer, search_path and grants stay as they are, and each patch fails loudly if
-- its anchor is missing.

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

do $$
declare
  v_def text := pg_get_functiondef('public.merge_contacts'::regproc);
begin
  -- The fields whose before and after are recorded for Undo.
  v_def := pg_temp.patched(v_def,
'''style_note'', ''style_updated_at'', ''ai_summary''
  ];',
'''style_note'', ''style_updated_at'', ''ai_summary'',
    ''vip'', ''about_note'', ''lead_source''
  ];');
  -- The merge itself.
  v_def := pg_temp.patched(v_def,
'    ai_summary = coalesce(c.ai_summary, v_merge.ai_summary)
  where c.id = p_keep',
'    ai_summary = coalesce(c.ai_summary, v_merge.ai_summary),
    vip = c.vip or v_merge.vip,
    about_note = coalesce(c.about_note, v_merge.about_note),
    lead_source = coalesce(c.lead_source, v_merge.lead_source)
  where c.id = p_keep');
  execute v_def;
end;
$$;

do $$
declare
  v_def text := pg_get_functiondef('public.undo_merge'::regproc);
begin
  v_def := pg_temp.patched(v_def,
'      ai_summary = r.ai_summary
    from jsonb_populate_record',
'      ai_summary = r.ai_summary, vip = r.vip, about_note = r.about_note, lead_source = r.lead_source
    from jsonb_populate_record');
  execute v_def;
end;
$$;

-- Same grants as before, restated because the definitions were replaced.
revoke execute on function public.merge_contacts(uuid, uuid, text, boolean, uuid) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid, text, boolean, uuid) to authenticated, service_role;
revoke execute on function public.undo_merge(uuid, uuid) from public, anon;
grant execute on function public.undo_merge(uuid, uuid) to authenticated, service_role;
