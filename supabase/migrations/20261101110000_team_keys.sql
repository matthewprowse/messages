-- Each workspace's data key, one level up from user_keys: it encrypts the work chats a team shares, field by
-- field ("t1:" values). Like a user's, it is only ever stored wrapped, by the same key-wrapping key
-- (KEY_WRAPPING_KEY for now, Google Cloud KMS later), with "team_keys:<workspace id>" as additional data so
-- a wrapped key cannot be moved to another workspace. wrapped_by names which wrapper made it ("local:v1").
-- No policies: only the service role, used by the workers and the key service, can read or write this table.
-- The key service hands it only to a workspace_members row whose status is 'active'.
create table public.team_keys (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  wrapped_key text not null,
  wrapped_by text not null,
  created_at timestamptz not null default now()
);

alter table public.team_keys enable row level security;
revoke all on public.team_keys from anon, authenticated;
