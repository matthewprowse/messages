-- Each user's data key, which encrypts their messages, contacts and drafts field by field. It is only ever
-- stored wrapped: encrypted by a key-wrapping key the database never sees (KEY_WRAPPING_KEY for now, Google
-- Cloud KMS later). wrapped_by names which wrapper made it ("local:v1"). No policies: only the service role,
-- used by the workers and the key service, can read or write this table.
create table public.user_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  wrapped_key text not null,
  wrapped_by text not null,
  created_at timestamptz not null default now()
);

alter table public.user_keys enable row level security;
revoke all on public.user_keys from anon, authenticated;
