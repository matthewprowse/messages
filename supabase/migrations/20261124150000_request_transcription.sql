-- Transcribe in the app for a voice note the AI worker held back (security audit 2026-11-03).
--
-- 20261124120000_voice_note_limits.sql defers a voice note from a conversation the user has never written in
-- (transcript_status 'deferred'), so outside senders cannot spend the user's AI allowance. The app shows such a note with
-- a Transcribe button, which puts it back in the AI worker's queue by setting the status to 'requested'. Not null: the
-- worker defers a null note from a stranger's conversation again, while 'requested' tells it the user asked, so it skips
-- that check (the conversation's daily cap and the budget still apply) and then sets done, silent or failed as usual.
-- App users can only update messages.is_read (column grants), so this function makes that one change: only 'deferred'
-- to 'requested', only on a message the caller can read (their own, or one in a shared chat they can see, as the
-- "Shared messages" policy decides). Returns true when the note was put back in the queue, false when there was nothing
-- to do.

create function public.request_transcription(p_message uuid) returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  update public.messages m set transcript_status = 'requested'
  where m.id = p_message and m.transcript_status = 'deferred'
    and (
      m.user_id = v_uid
      or (m.workspace_id is not null and m.workspace_id = public.my_workspace_id() and public.can_read_thread_at(m.thread_id, m.workspace_id, m.sent_at))
    );
  return found;
end;
$$;
revoke execute on function public.request_transcription(uuid) from public, anon;
grant execute on function public.request_transcription(uuid) to authenticated;
