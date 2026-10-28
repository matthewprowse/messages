-- Retention for finished work-queue rows. These tables are queues the workers drain; once a row is done or failed
-- nothing reads it again, so it only grows the table and its indexes. A daily job (pg_cron, scheduled the way
-- analytics_prune is in 20261026200000) removes, in bounded batches:
--   mail_actions, calendar_outbox (created or failed), calendar_deletes, calendar_updates, task_updates:
--     done or failed rows older than 30 days. Rows still queued or being worked are never touched.
--   outbox: sent or failed rows older than 30 days. The app shows sent mail from messages, not from here. Deleting
--     an outbox row cascades to its outbox_attachments rows only. The learning job reads recent sent rows with a
--     draft (apps/ai/ai/learn.py looks at the newest 100), so 30 days is far beyond what it needs.
--     The files in the attachments bucket under "<user>/outbox/" are not removed by this job (SQL cannot safely
--     remove storage objects); the worker's own cleanup or a separate sweep owns those.
--   share_jobs: done rows older than 30 days, and failed rows older than 30 days that have used all 5 attempts
--     (a failed row with fewer attempts still reads as "sharing" in the app, so it is left alone).
--   drafts: revised, expired, sent and discarded drafts older than 60 days. This is safe for learning:
--     draft_outcomes.draft_id and outbox.draft_id are "on delete set null", so the outcomes (the draft and sent
--     text learning reads) stay, only their link to the old draft goes. learn.py checks outcomes only for drafts
--     from the last 14 days, well inside the 60. Active, pending and failed drafts are kept.
-- Messages, attachments, threads and anything else you see in the app are not touched.
--
-- retention_delete runs batches of at most 5000 rows, at most 10 batches a table a run, so one run never holds
-- row locks on more than 50000 rows of a table and a backlog clears over a few days. The tables are scanned by
-- status and age; they are small queue tables (drafts is the largest), and if drafts grows large add an index
-- on (created_at) where status in the terminal set. The function is service role / postgres only.
-- Creating the function and the schedule is safe to repeat.

create or replace function public.retention_delete(p_table text, p_where text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_n integer;
begin
  if p_table not in ('mail_actions', 'calendar_outbox', 'calendar_deletes', 'calendar_updates', 'task_updates', 'outbox', 'share_jobs', 'drafts') then
    raise exception 'retention_delete: table % is not allowed', p_table;
  end if;
  for i in 1..10 loop
    execute format(
      'delete from public.%I where id in (select id from public.%I where %s limit 5000)',
      p_table, p_table, p_where
    );
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < 5000;
  end loop;
  return v_total;
end
$$;
revoke execute on function public.retention_delete(text, text) from public, anon, authenticated;

create or replace function public.retention_prune()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.retention_delete('mail_actions', $w$status in ('done', 'failed') and created_at < now() - interval '30 days'$w$);
  perform public.retention_delete('calendar_outbox', $w$status in ('created', 'failed') and created_at < now() - interval '30 days'$w$);
  perform public.retention_delete('calendar_deletes', $w$status in ('done', 'failed') and created_at < now() - interval '30 days'$w$);
  perform public.retention_delete('calendar_updates', $w$status in ('done', 'failed') and created_at < now() - interval '30 days'$w$);
  perform public.retention_delete('task_updates', $w$status in ('done', 'failed') and created_at < now() - interval '30 days'$w$);
  perform public.retention_delete('outbox', $w$status in ('sent', 'failed') and created_at < now() - interval '30 days'$w$);
  perform public.retention_delete('share_jobs', $w$(status = 'done' or (status = 'failed' and attempts >= 5)) and created_at < now() - interval '30 days'$w$);
  perform public.retention_delete('drafts', $w$status in ('revised', 'expired', 'sent', 'discarded') and created_at < now() - interval '60 days'$w$);
end
$$;
revoke execute on function public.retention_prune() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('retention-prune', '41 3 * * *', 'select public.retention_prune()');
exception when others then
  raise notice 'pg_cron not available, run select public.retention_prune() yourself: %', sqlerrm;
end
$$;
