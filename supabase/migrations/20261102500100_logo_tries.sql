-- Company logos: a limit on tries (docs/PLAN.md, Security and Cost Review, cost drivers). A Gemini step that fails
-- was tried again forever. The AI worker now counts failures in ai_tries, waits longer after each (ai_next_try_at),
-- and after the maximum gives the company up: status done, no logo, and ai_retry_after 30 days ahead, before which
-- the sync worker should not queue it again. A step that works resets the count.
alter table public.company_logos
  add column ai_tries smallint not null default 0,
  add column ai_next_try_at timestamptz,
  add column ai_retry_after timestamptz;

create index company_logos_ai_wait_idx on public.company_logos (ai_next_try_at) where status in ('judging', 'searching');
