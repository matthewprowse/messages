-- Drops the reason behind a triage label. The owner found the reasons often wrong, so the app no longer shows them
-- (the hover card on the Urgent and Needs Reply tags and the line under a conversation's header are gone) and triage no
-- longer asks the model for one or writes one. suspicious stays: it drives the fraud warning.
--
-- Apply only once the AI worker without reasons is running: an older worker still writes these columns and its writes
-- would fail without them (docs/RUNBOOK.md, migrations before code that needs them, never the other way round).

alter table public.message_ai
  drop column triage_reason,
  drop column triage_reason_text;

alter table public.threads
  drop column triage_reason,
  drop column triage_reason_text;
