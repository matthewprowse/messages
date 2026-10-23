-- Attachment cleanup: signature images, tracking pixels and bulk-mail files are hidden from the attachment
-- lists. hidden_reason says why:
--   inline  a picture drawn inside the email (referenced from the HTML by cid:), or another body part
--   tiny    an image under 15 KB or under 100 px, almost always a logo, icon or spacer
--   junk    a file in a conversation marked junk, newsletter or notification
--   manual  you hiding one yourself
-- The sync worker sets inline and tiny when it stores new mail, since only it sees the MIME parts.
-- junk follows the conversation: the triggers below keep it in step as conversations are triaged,
-- marked junk or marked not junk. inline, tiny and manual are never changed by those triggers.

-- Receipts, tickets, invoices and statements are kept even when they arrive in bulk mail.
create or replace function public.attachment_looks_kept(p_filename text, p_subject text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_filename, '') || ' ' || coalesce(p_subject, '')
    ~* '(receipt|invoice|ticket|statement|booking|itinerary|confirmation|reservation|boarding|voucher|order|tax|bill|payslip|payment|purchase|quotation|quote|rechnung|factura|factuur|recibo)'
$$;

-- Whether one attachment counts as junk: incoming, in a junk, newsletter or notification conversation,
-- and not a PDF that looks like a receipt.
create or replace function public.attachment_is_junk(p_kind text, p_filename text, p_subject text, p_direction text, p_thread_junk boolean, p_thread_category text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_direction = 'inbound'
    and (coalesce(p_thread_junk, false) or coalesce(p_thread_category, '') in ('newsletter', 'notification'))
    and not (p_kind = 'pdf' and public.attachment_looks_kept(p_filename, p_subject))
$$;

-- Brings the junk mark of every attachment in one conversation up to date.
create or replace function public.refresh_attachment_junk(p_thread_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.attachments a
  set hidden = x.junk, hidden_reason = case when x.junk then 'junk' end
  from (
    select a2.id, public.attachment_is_junk(a2.kind, a2.filename, m.subject, m.direction, t.junk, t.category) as junk
    from public.attachments a2
    join public.messages m on m.id = a2.message_id
    join public.threads t on t.id = m.thread_id
    where t.id = p_thread_id
  ) x
  where a.id = x.id
    and (a.hidden_reason is null or a.hidden_reason = 'junk')
    and a.hidden is distinct from x.junk;
$$;

create or replace function public.attachment_junk_on_thread_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_attachment_junk(new.id);
  return null;
end;
$$;

create trigger threads_attachment_junk
  after update of junk, category on public.threads
  for each row
  when (old.junk is distinct from new.junk or old.category is distinct from new.category)
  execute function public.attachment_junk_on_thread_change();

-- New attachments in a conversation that is already junk start hidden.
create or replace function public.attachment_junk_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hidden_reason is null then
    select public.attachment_is_junk(new.kind, new.filename, m.subject, m.direction, t.junk, t.category)
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

create trigger attachments_junk_on_insert
  before insert on public.attachments
  for each row
  execute function public.attachment_junk_on_insert();

revoke execute on function public.attachment_looks_kept(text, text) from public, anon, authenticated;
revoke execute on function public.attachment_is_junk(text, text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.refresh_attachment_junk(uuid) from public, anon, authenticated;
revoke execute on function public.attachment_junk_on_thread_change() from public, anon, authenticated;
revoke execute on function public.attachment_junk_on_insert() from public, anon, authenticated;
grant execute on function public.attachment_looks_kept(text, text) to service_role;
grant execute on function public.attachment_is_junk(text, text, text, text, boolean, text) to service_role;
grant execute on function public.refresh_attachment_junk(uuid) to service_role;

-- The attachment lists only ever ask for visible files.
create index attachments_visible_idx on public.attachments (user_id, created_at desc) where not hidden;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- inline: images the HTML draws by cid:<file name> (older mail has no stored content ID, so the file
-- name is what matches), and AMP copies of the email body, which are another version of the text.
update public.attachments a
set hidden = true, hidden_reason = 'inline'
from public.messages m
where m.id = a.message_id
  and a.hidden_reason is null
  and (
    (a.kind = 'image' and m.body_html is not null and position(lower('cid:' || a.filename) in lower(m.body_html)) > 0)
    or a.mime_type = 'text/x-amp-html'
  );

-- tiny: small images. Pixel sizes are only known for new mail, so the backfill goes by file size.
update public.attachments
set hidden = true, hidden_reason = 'tiny'
where hidden_reason is null and kind = 'image' and size_bytes < 15360;

-- junk: everything left, conversation by conversation.
update public.attachments a
set hidden = true, hidden_reason = 'junk'
from public.messages m
join public.threads t on t.id = m.thread_id
where m.id = a.message_id
  and a.hidden_reason is null
  and public.attachment_is_junk(a.kind, a.filename, m.subject, m.direction, t.junk, t.category);
