-- Meta webhook hints: the web route (apps/web/app/api/meta/webhook) writes one row whenever Meta says an
-- Instagram account has news, and the Instagram connector (apps/ai/ai/connectors/instagram) reads the account's
-- inbox at once instead of waiting for its next poll. A hint is content free on purpose: only which
-- professional account the event was for (Meta's numeric ID, the entry ID of the payload), what kind of event
-- it was and when it arrived. No sender, no conversation, no text, so nothing here needs sealing. The connector
-- finds the conversation itself, from the inbox. Service role only: no policies, so no user can read it.

create table public.meta_webhook_hints (
  id bigint generated always as identity primary key,
  provider text not null default 'instagram' check (provider in ('instagram')),
  ig_user_id text not null check (char_length(ig_user_id) between 1 and 40),
  kind text not null default 'message' check (kind in ('message', 'seen', 'reaction', 'other')),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

alter table public.meta_webhook_hints enable row level security;
revoke all on public.meta_webhook_hints from anon, authenticated;
grant select, insert, update, delete on public.meta_webhook_hints to service_role;

-- The connector asks for the unread hints of one account, oldest first.
create index meta_webhook_hints_waiting_idx on public.meta_webhook_hints (provider, ig_user_id, id) where consumed_at is null;
create index meta_webhook_hints_created_idx on public.meta_webhook_hints (created_at);
