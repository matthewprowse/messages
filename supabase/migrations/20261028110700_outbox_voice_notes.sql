-- Voice notes recorded in the app and sent on WhatsApp.
--
-- The app records in the browser, uploads the recording like any other outbox file and marks its
-- outbox_attachments row voice_note = true. The worker converts it to Ogg Opus with ffmpeg and sends it
-- as a WhatsApp voice note (ptt) rather than an audio file. Only audio can be marked.

alter table public.outbox_attachments add column voice_note boolean not null default false;
alter table public.outbox_attachments add constraint outbox_attachments_voice_note_check
  check (not voice_note or mime_type like 'audio/%');

-- The insert policy "Attach files to own queued messages" is unchanged: the column needs no extra condition.
