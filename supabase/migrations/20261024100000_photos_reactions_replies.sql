-- Contact photos, replying to a chosen message, and WhatsApp reactions sent from the app.

-- ---------------------------------------------------------------------------
-- 1. Photos
-- ---------------------------------------------------------------------------

-- A contact's photo, saved by the worker in the private "avatars" bucket at <user id>/<contact id>.
-- Photos from your own address book (iCloud or Google Contacts) win over WhatsApp profile pictures.
alter table public.contacts add column avatar_path text;
alter table public.contacts add column avatar_source text check (avatar_source in ('icloud', 'google', 'whatsapp'));
alter table public.contacts add column avatar_updated_at timestamptz;

-- A WhatsApp group's picture, at <user id>/thread-<thread id>.
alter table public.threads add column avatar_path text;
alter table public.threads add column avatar_updated_at timestamptz;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy "Read own avatars" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 2. Replying to a chosen message
-- ---------------------------------------------------------------------------

-- Null means the usual: an email answers the latest message from someone else, and a WhatsApp reply
-- quotes nothing. Set, an email answers that message and a WhatsApp reply quotes it.
alter table public.outbox add column reply_to_message_id uuid references public.messages (id) on delete set null;
create index outbox_reply_to_idx on public.outbox (reply_to_message_id) where reply_to_message_id is not null;

-- On top of the existing insert policy: the chosen message must be in the same conversation.
create policy "Reply to a message in the same conversation" on public.outbox as restrictive for insert to authenticated
  with check (
    outbox.reply_to_message_id is null
    or exists (
      select 1 from public.messages m
      where m.id = outbox.reply_to_message_id and m.thread_id = outbox.thread_id and m.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Reactions sent from the app (WhatsApp)
-- ---------------------------------------------------------------------------

-- A 'react' action names the message and the emoji; an empty emoji removes your reaction. The worker
-- sends it over the linked device and records it in the message's provider_meta.reactions under 'me'.
alter table public.mail_actions add column message_id uuid references public.messages (id) on delete cascade;
alter table public.mail_actions add column emoji text check (char_length(emoji) <= 16);
create index mail_actions_message_idx on public.mail_actions (message_id) where message_id is not null;

alter table public.mail_actions drop constraint mail_actions_action_check;
alter table public.mail_actions add constraint mail_actions_action_check
  check (action in ('read', 'unread', 'archive', 'unarchive', 'trash', 'untrash', 'spam', 'unspam', 'react'));
alter table public.mail_actions add constraint mail_actions_react_check
  check ((action = 'react') = (message_id is not null and emoji is not null));

create policy "React to a message in the same conversation" on public.mail_actions as restrictive for insert to authenticated
  with check (
    mail_actions.message_id is null
    or exists (
      select 1 from public.messages m
      where m.id = mail_actions.message_id and m.thread_id = mail_actions.thread_id and m.user_id = (select auth.uid())
    )
  );
