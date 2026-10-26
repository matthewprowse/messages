-- Notes: private notes written in the app, stored as markdown, with files attached.
--
-- The title, body and file names are encrypted in the browser (fields note_title, note and note_file)
-- when content encryption is on. Files live in the private attachments bucket at
-- "<user id>/notes/<note id>/<uuid>", so the path says nothing about the file.

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_updated_idx on public.notes (user_id, updated_at desc);
create trigger set_updated_at before update on public.notes for each row execute function public.set_updated_at();

create table public.note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null unique,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

create index note_attachments_note_idx on public.note_attachments (note_id);

alter table public.notes enable row level security;
alter table public.note_attachments enable row level security;

create policy "Own rows" on public.notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Read own note files" on public.note_attachments for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Delete own note files" on public.note_attachments for delete to authenticated
  using (user_id = (select auth.uid()));

-- A file row must point at a file this user already uploaded, under one of their own notes, in exactly
-- the app's format.
create policy "Attach files to own notes" on public.note_attachments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and storage_path = (select auth.uid())::text || '/notes/' || note_id::text || '/' || split_part(storage_path, '/', 4)
    and split_part(storage_path, '/', 4) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (select 1 from public.notes n where n.id = note_attachments.note_id and n.user_id = (select auth.uid()))
    and exists (
      select 1 from storage.objects so
      where so.bucket_id = 'attachments'
        and so.name = note_attachments.storage_path
        and so.owner_id = (select auth.uid())::text
    )
  );

-- A file row never changes once added.
revoke all on public.note_attachments from anon;
revoke update, truncate on public.note_attachments from authenticated;
revoke all on public.notes from anon;

-- ---------------------------------------------------------------------------
-- Note files in storage
-- ---------------------------------------------------------------------------

-- "Read own attachments" already covers reading. Uploads never overwrite (no update policy), and files
-- can be deleted when they are taken out of a note or the note is deleted.
create policy "Upload own note files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'notes'
  );

create policy "Delete own note files" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'notes'
  );
