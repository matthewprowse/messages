-- Names are sealed (audit H5): contacts.display_name, organizations.name and threads.group_name are written as
-- ciphertext (field "name", packages/crypto/src/fields.ts) by the sync worker, the AI worker and the browser. The
-- database can no longer read a name, so the two things it used to work out from one are now told to it:
--
--   * contacts.display_name_rank: what kind of name the contact has, set by whoever writes the name. A better kind
--     replaces a worse one (WhatsApp, LinkedIn, Instagram and Google Chat used to compare the text for this, and merge
--     used it to pick the name to keep):
--       0  a stand-in: a number, an address, a privacy ID, a LinkedIn URN or a word like "WhatsApp Contact"
--       1  a name the person set for themselves: a WhatsApp profile name or an Instagram handle
--       2  a real name: saved in an address book, typed by you, or given by the provider
--   * threads.group_name_index: a blind index of the group's name under the user's index key ("group:" + name,
--     packages/crypto/src/addresses.ts), so ingest can tell a renamed group from the same name sealed again without
--     rewriting the row on every message. Only equality within one user's rows is learnt from it.
--
-- Rows written before this keep their readable names until apps/worker/scripts/seal-names.ts seals them. Their rank is
-- worked out here from the readable text, with the rules the functions used.

alter table public.contacts add column display_name_rank smallint not null default 2;
alter table public.contacts add constraint contacts_display_name_rank_check check (display_name_rank between 0 and 2);
comment on column public.contacts.display_name_rank is
  'What kind of name display_name is (it is sealed, so the database cannot tell): 0 a stand-in (number, address, privacy ID, URN, "WhatsApp Contact"), 1 a name the person set for themselves (WhatsApp profile name, Instagram handle), 2 a real name. Set by the writer; a higher rank replaces a lower one.';

alter table public.threads add column group_name_index text;
comment on column public.threads.group_name_index is
  'Blind index of group_name under the user''s index key (addresses.ts groupNameIndex). Ingest compares it to tell a renamed group from the same name sealed again.';

-- Readable names that are stand-ins. Sealed values ("e1:", "t1:") are real names written by the AI worker.
update public.contacts c set display_name_rank = 0
where coalesce(c.display_name, '') !~ '^[et]1:'
  and (public.contact_name_is_placeholder(c.display_name)
    or c.display_name in ('WhatsApp Contact', 'LinkedIn Member', 'Instagram Contact', 'Zoom Contact', 'Contact')
    or c.display_name like 'urn:li:%');

-- A shared chat's group name is shown to the team, so it moves to the team's key with the chat's other text
-- (src/share/reseal.ts THREAD_TEXT), and a rename after sharing queues the follow-up job that moves it.
create or replace function public.thread_needs_team_seal(t public.threads) returns boolean
  language sql immutable set search_path = ''
as $$
  select t.workspace_id is not null and (
    public.needs_team_seal(t.subject)
    or public.needs_team_seal(t.group_name)
    or (coalesce(t.share_from is null or t.last_message_at >= t.share_from, false)
        and (public.needs_team_seal(t.last_message_preview) or public.needs_team_seal(t.summary)))
  )
$$;

drop trigger threads_share_update on public.threads;
create trigger threads_share_update after update of subject, last_message_preview, summary, last_message_at, group_name on public.threads
  for each row when (new.workspace_id is not null) execute function public.share_followup_on_thread();
