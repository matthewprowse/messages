-- Editing your own text. A draft with tone 'edit' asks the AI worker to make light changes to what you
-- wrote (drafts.source, encrypted as a draft body) instead of writing a reply from scratch: spelling,
-- grammar and unclear phrasing, with your words, order and length kept. The result is the draft's body
-- as usual, so it arrives, is sent and is learned from like any other draft; source stays for Undo.
--
-- Additive: the worker and app before this never write tone 'edit' or read source.
alter table public.drafts add column source text;

alter table public.drafts drop constraint drafts_tone_check;
alter table public.drafts add constraint drafts_tone_check
  check (tone in ('default', 'shorter', 'formal', 'casual', 'custom', 'edit'));
