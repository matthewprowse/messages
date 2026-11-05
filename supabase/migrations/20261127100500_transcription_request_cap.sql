-- A daily cap per person on Transcribe requests (security audit 2026-11-04, Low).
--
-- request_transcription (20261124150000) lets anyone who can read a message ask for its held-back voice note to be
-- transcribed: the message's owner, or a teammate reading it through a shared chat. The note is billed to the owner's
-- Voice Notes share, and the 20 a day cap (20261124120000) is per conversation, not per requester, so a teammate with
-- many shared chats could spend a colleague's whole share. Same access as before; the caller is now also counted in
-- rate_limits (30 requests a day, far above what reviewing a day's voice notes takes) and refused past that with the
-- same SQLSTATE 54000 shape as the other request caps (transcription_limit). The AI worker (service role) does not go
-- through this function.

create or replace function public.request_transcription(p_message uuid) returns boolean
  language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.rate_limit_hit('db:transcription:' || v_uid::text, 30, 86400) > 0 then -- 86400 s: one UTC day
    raise exception 'transcription_limit' using errcode = '54000', hint = 'At most 30 voice notes can be asked for in a day.';
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
