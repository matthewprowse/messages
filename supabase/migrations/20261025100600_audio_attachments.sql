-- Voice notes and other audio get their own attachment kind, so the app plays them in the conversation
-- instead of offering a file to download. WhatsApp voice notes were stored as kind 'file'.
alter table public.attachments drop constraint attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check check (kind in ('image', 'pdf', 'video', 'audio', 'file'));

update public.attachments set kind = 'audio'
where kind = 'file' and (mime_type like 'audio/%' or filename ~* '^(voice note|audio)\.[a-z0-9]+$');
