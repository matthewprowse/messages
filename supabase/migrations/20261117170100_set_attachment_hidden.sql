-- Hide and Unhide a file from the viewer. Users have no update policy on attachments (and should not: the worker owns
-- the row), so this narrow function flips only hidden and hidden_reason, only on the caller's own files. A file the user
-- hides is reason 'manual', which the junk triggers leave alone (they touch only null and 'junk' reasons).

create or replace function public.set_attachment_hidden(p_ids uuid[], p_hidden boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.attachments
  set hidden = p_hidden,
      hidden_reason = case when p_hidden then 'manual' end
  where id = any (p_ids)
    and user_id = (select auth.uid())
    and hidden is distinct from p_hidden;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function public.set_attachment_hidden(uuid[], boolean) from public, anon;
grant execute on function public.set_attachment_hidden(uuid[], boolean) to authenticated;
