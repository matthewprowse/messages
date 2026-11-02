-- The Attachments page pages through files newest message first with a keyset on (sent_at, id). The sent time lives on
-- messages, and PostgREST cannot order a table by a joined column, so it is copied onto attachments once at insert
-- (a message's sent_at never changes). Also: the partial indexes the page's two lists and the hidden count use, and
-- Realtime on attachments so a file that arrives while the page is open shows up.

alter table public.attachments add column if not exists sent_at timestamptz;

-- Fill older rows in one pass.
update public.attachments a
set sent_at = m.sent_at
from public.messages m
where m.id = a.message_id and a.sent_at is null;

create or replace function public.attachment_copy_sent_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sent_at is null then
    select m.sent_at into new.sent_at from public.messages m where m.id = new.message_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.attachment_copy_sent_at() from public, anon, authenticated;

drop trigger if exists attachments_copy_sent_at on public.attachments;
create trigger attachments_copy_sent_at
  before insert on public.attachments
  for each row
  execute function public.attachment_copy_sent_at();

-- Visible files and hidden files each page newest first; the kind tabs filter on top of the same order.
create index if not exists attachments_library_idx on public.attachments (user_id, sent_at desc, id desc) where not hidden;
create index if not exists attachments_library_hidden_idx on public.attachments (user_id, sent_at desc, id desc) where hidden;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attachments') then
    alter publication supabase_realtime add table public.attachments;
  end if;
end $$;
