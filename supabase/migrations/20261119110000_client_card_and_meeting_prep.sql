-- Client summary card and meeting prep (Wave 5). Both are written by the AI worker from stored summaries only
-- (apps/ai/ai/people.py, apps/ai/ai/prep.py) and sealed per user, so the app opens them in the browser.
--
-- 1. client_cards: one paragraph on the state of the relationship with a contact ("Quote sent 12 Oct, awaiting
--    signature, last contact 9 days ago, prefers WhatsApp"). Rewritten when new activity arrives, at most once a day.
--    The Refresh button calls request_client_card_refresh(), which is capped per day here in the database so the cap
--    holds however the call is made; the worker honours requested_at.
-- 2. event_preps: a short brief per attendee for one calendar event, built 30 minutes before it starts. brief is a
--    sealed JSON text: {"people": [{"contact_id", "name", "who", "recent": [], "promises": [], "last_meeting", "asked"}]}.

create table public.client_cards (
  contact_id uuid primary key references public.contacts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  /** The paragraph, sealed under the contact_summary field. Null until the first one is written. */
  card text,
  /** When card was written. */
  updated_at timestamptz,
  /** The newest activity (message, meeting) the card took into account, so only newer activity makes it stale. */
  activity_at timestamptz,
  /** Set by request_client_card_refresh; the worker rewrites the card when this is newer than updated_at. */
  requested_at timestamptz,
  refresh_day date not null default current_date,
  refresh_count integer not null default 0
);

create index client_cards_user_idx on public.client_cards (user_id);
create index client_cards_requested_idx on public.client_cards (requested_at) where requested_at is not null;

alter table public.client_cards enable row level security;
revoke all on public.client_cards from anon, authenticated;
grant select on public.client_cards to authenticated;
create policy "Read own client cards" on public.client_cards for select to authenticated
  using (user_id = (select auth.uid()));

-- Asks for a fresh card, at most 3 times a day per contact. Returns how many asks are left today, or -1 when the
-- contact is not yours. Written here, not in a table policy, so the cap cannot be skipped by calling the table.
create or replace function public.request_client_card_refresh(p_contact uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.client_cards;
  v_cap constant integer := 3;
begin
  if v_user is null or not exists (select 1 from public.contacts c where c.id = p_contact and c.user_id = v_user) then
    return -1;
  end if;
  insert into public.client_cards (contact_id, user_id) values (p_contact, v_user) on conflict (contact_id) do nothing;
  select * into v_row from public.client_cards where contact_id = p_contact and user_id = v_user for update;
  if v_row.refresh_day <> current_date then
    v_row.refresh_day := current_date;
    v_row.refresh_count := 0;
  end if;
  if v_row.refresh_count >= v_cap then
    return 0;
  end if;
  update public.client_cards
    set refresh_day = v_row.refresh_day, refresh_count = v_row.refresh_count + 1, requested_at = now()
    where contact_id = p_contact;
  return v_cap - v_row.refresh_count - 1;
end;
$$;
revoke execute on function public.request_client_card_refresh(uuid) from public, anon;
grant execute on function public.request_client_card_refresh(uuid) to authenticated;

create table public.event_preps (
  event_id uuid primary key references public.calendar_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  /** Sealed JSON text, see the header. */
  brief text not null,
  /** The event's start when the brief was built, so a moved event is prepared again. */
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index event_preps_user_idx on public.event_preps (user_id, starts_at desc);

alter table public.event_preps enable row level security;
revoke all on public.event_preps from anon, authenticated;
grant select on public.event_preps to authenticated;
create policy "Read own event preps" on public.event_preps for select to authenticated
  using (user_id = (select auth.uid()));
