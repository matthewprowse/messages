-- A draft you kept working on. Edit Text and the Adjust menu (Shorter, More Formal, More Casual) start
-- from the text in the reply box (drafts.source) and replace the draft that was there. That draft was
-- not turned down, so it is 'revised', not 'discarded': learning reads 'discarded' as a draft thrown
-- away (signals.py, learn.py) and leaves this one out, like 'expired'.
alter table public.drafts drop constraint drafts_status_check;
alter table public.drafts add constraint drafts_status_check
  check (status in ('pending', 'active', 'sent', 'discarded', 'failed', 'expired', 'revised'));
