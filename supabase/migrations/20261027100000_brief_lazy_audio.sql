-- The daily brief is spoken only when someone listens. Speech was about 93% of what a brief cost, and the
-- brief written each morning was spoken whether or not anyone pressed Listen.
--
-- The worker now writes the morning brief as a script only (status 'written'). Pressing Listen asks for
-- it to be spoken (status 'speak_pending', set by the app); the worker speaks it, stores the parts and
-- the brief goes 'speaking' then 'ready' as before. A brief asked for in the app (status 'pending')
-- is still written and spoken in one go, as the person is waiting to hear it.
--
-- A 'speak_pending' nobody picked up within minutes goes back to 'written' (the worker sweeps them).
alter table public.briefs drop constraint briefs_status_check;
alter table public.briefs add constraint briefs_status_check
  check (status in ('pending', 'working', 'written', 'speak_pending', 'speaking', 'ready', 'failed'));

create index briefs_speak_pending_idx on public.briefs (updated_at) where status = 'speak_pending';
