-- The speech model's own pace is slow for a brief, and asking it to speak faster in the prompt gets the
-- request read aloud, so briefs play a little faster by default. Profiles still on the old default move.
alter table public.profiles alter column brief_speed set default 1.15;
update public.profiles set brief_speed = 1.15 where brief_speed = 1.00;
