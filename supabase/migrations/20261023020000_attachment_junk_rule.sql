-- Files are hidden as 'junk' only when the conversation itself is junk. Being triaged as a newsletter
-- or notification is not enough: those conversations carry calendar invites, tickets and statements
-- people want. Calendar files are always kept, as are PDFs that look like receipts.
-- The signature stays the same so the triggers from attachment_cleanup keep working; p_thread_category
-- is no longer used.
create or replace function public.attachment_is_junk(p_kind text, p_filename text, p_subject text, p_direction text, p_thread_junk boolean, p_thread_category text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_direction = 'inbound'
    and coalesce(p_thread_junk, false)
    and not (p_kind = 'pdf' and public.attachment_looks_kept(p_filename, p_subject))
    and lower(coalesce(p_filename, '')) !~ '\.(ics|ical|ifb|vcs)$'
$$;

revoke execute on function public.attachment_is_junk(text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.attachment_is_junk(text, text, text, text, boolean, text) to service_role;

-- Calendar files are kept by MIME type as well, which the function above does not see, so the two
-- callers check it too.
create or replace function public.refresh_attachment_junk(p_thread_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.attachments a
  set hidden = x.junk, hidden_reason = case when x.junk then 'junk' end
  from (
    select a2.id,
      public.attachment_is_junk(a2.kind, a2.filename, m.subject, m.direction, t.junk, t.category)
        and lower(coalesce(a2.mime_type, '')) not in ('text/calendar', 'application/ics') as junk
    from public.attachments a2
    join public.messages m on m.id = a2.message_id
    join public.threads t on t.id = m.thread_id
    where t.id = p_thread_id
  ) x
  where a.id = x.id
    and (a.hidden_reason is null or a.hidden_reason = 'junk')
    and a.hidden is distinct from x.junk;
$$;

create or replace function public.attachment_junk_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hidden_reason is null then
    select public.attachment_is_junk(new.kind, new.filename, m.subject, m.direction, t.junk, t.category)
      and lower(coalesce(new.mime_type, '')) not in ('text/calendar', 'application/ics')
    into new.hidden
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = new.message_id;
    new.hidden := coalesce(new.hidden, false);
    if new.hidden then new.hidden_reason := 'junk'; end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.refresh_attachment_junk(uuid) from public, anon, authenticated;
revoke execute on function public.attachment_junk_on_insert() from public, anon, authenticated;
grant execute on function public.refresh_attachment_junk(uuid) to service_role;

update public.attachments
set hidden = false, hidden_reason = null
where hidden_reason = 'junk'
  and lower(coalesce(mime_type, '')) in ('text/calendar', 'application/ics');

-- Recompute every remaining junk mark under the new rule.
update public.attachments a
set hidden = false, hidden_reason = null
from public.messages m
join public.threads t on t.id = m.thread_id
where m.id = a.message_id
  and a.hidden_reason = 'junk'
  and not public.attachment_is_junk(a.kind, a.filename, m.subject, m.direction, t.junk, t.category);
