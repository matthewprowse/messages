-- The reply box's own settings (wave 4): a signature for each address you send from, a default send-from for each
-- account, your own templates and snippets, and a default tone for drafts.
--
-- 1. account_composer: one row per account. `settings` is a JSON object sealed in the browser with the user's key
--    ({ signatures: { address: text }, defaultFrom: address }), so the server never holds a readable signature or
--    address. `has_signature` is the one plain fact the AI worker needs (to stop a draft writing its own signature
--    block); it says nothing about the text.
-- 2. user_templates: templates (picked from a menu) and snippets (typed as ;shortcut). Title, shortcut and body are
--    sealed in the browser. Team templates stay where they are (workspace_voice_items).
-- 3. profiles.draft_tone: Formal, Friendly or Brief, which the AI worker reads when it writes a draft. Null means the
--    usual voice.
-- Additive: nothing here is read by an app that predates it.

create table public.account_composer (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  settings text not null check (length(settings) <= 20000),
  has_signature boolean not null default false,
  updated_at timestamptz not null default now()
);
create index account_composer_user_idx on public.account_composer (user_id);

create table public.user_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('template', 'snippet')),
  title text not null check (length(title) <= 1000),
  shortcut text check (shortcut is null or length(shortcut) <= 1000),
  body text not null check (length(body) <= 12000),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index user_templates_user_idx on public.user_templates (user_id, position, created_at);

alter table public.profiles add column draft_tone text check (draft_tone in ('formal', 'friendly', 'brief'));

do $$
declare
  t text;
begin
  foreach t in array array['account_composer', 'user_templates']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "Own rows" on public.%I for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;
