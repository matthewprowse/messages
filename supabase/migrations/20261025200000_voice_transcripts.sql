-- WhatsApp voice notes are transcribed by the AI worker (Gemini), so they can be read in the app with
-- View Transcript, and so triage, the daily brief and drafting know what was said.
--
-- messages.transcript: what was said, encrypted (field "transcript"). messages.transcript_status: null
-- while it has not been tried (or the message has no voice note), 'done' with a transcript, 'silent'
-- when nothing was said, 'failed' after the worker gave up.
alter table public.messages add column transcript text;
alter table public.messages add column transcript_status text check (transcript_status in ('done', 'silent', 'failed'));

-- Transcribing has its own line in Settings, Usage.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in ('triage', 'draft', 'learn', 'brief', 'transcribe'));
