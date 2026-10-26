-- The daily brief's audio in parts, so playing starts within seconds: the first part is short and
-- spoken first, and the rest are spoken at the same time and stored as each is ready. The app plays
-- them in order. One WAV file for the whole brief took about a minute to make and several seconds to
-- download before a word was heard.
--
-- Also the voice and speed, chosen in Settings: the worker speaks with profiles.brief_voice, and the app
-- plays at profiles.brief_speed.

-- Briefs made so far have their audio in one column, which goes. They are only today's test briefs.
delete from public.briefs;
alter table public.briefs drop column audio;
alter table public.briefs add column parts integer;
alter table public.briefs add column voice text;
alter table public.briefs drop constraint briefs_status_check;
-- speaking: the script and the first parts are stored, the rest are on their way.
alter table public.briefs add constraint briefs_status_check check (status in ('pending', 'working', 'speaking', 'ready', 'failed'));

create table public.brief_parts (
  brief_id uuid not null references public.briefs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seq integer not null,
  audio text not null, -- WAV in base64, encrypted (field "brief")
  seconds integer,
  primary key (brief_id, seq)
);

alter table public.brief_parts enable row level security;
create policy "Read own brief parts" on public.brief_parts for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.brief_parts from authenticated;

alter table public.profiles add column brief_voice text not null default 'Kore'
  check (brief_voice in ('Kore', 'Aoede', 'Sulafat', 'Charon', 'Achird', 'Iapetus'));
alter table public.profiles add column brief_speed numeric(3, 2) not null default 1.00
  check (brief_speed between 0.75 and 2.00);
