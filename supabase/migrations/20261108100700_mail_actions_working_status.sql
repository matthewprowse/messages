-- The sync worker needs a claim state so that a poll that starts while another is still applying an action
-- cannot run it again: it marks the row 'working' first. mail_actions.status was limited to
-- queued, done, failed (an unnamed check, so named mail_actions_status_check). This allows 'working' too.
-- Widening a check cannot be broken by old rows, but the new check is still added NOT VALID and then validated.
-- The app's insert policy still only allows status = 'queued', so people cannot set the claim themselves.
-- Validation scans the table once and holds only a light lock.
alter table public.mail_actions drop constraint if exists mail_actions_status_check;
alter table public.mail_actions add constraint mail_actions_status_check
  check (status in ('queued', 'working', 'done', 'failed')) not valid;
alter table public.mail_actions validate constraint mail_actions_status_check;
