-- drafts.audio_path was only checked with "like '<user>/drafts/%'", so "<user>/drafts/../../<other user>/x"
-- passed, and the AI worker downloads and deletes these paths with the service role. The new check holds the
-- path to "<user id>/drafts/" followed by plain segments of letters, digits, dot, underscore and hyphen, and
-- refuses any "." or ".." segment. Same idea as the outbox_attachments path rule (20261023110000).
-- It is added NOT VALID, so it applies to every new or changed row straight away without scanning the table
-- or failing on old rows. It is then validated only when no existing row breaks it; if some do, it stays NOT
-- VALID (still enforced for new writes) and a notice says so, so the migration never fails on old data.
-- The old drafts_audio_path_check stays; the two together are stricter than either alone.
alter table public.drafts drop constraint if exists drafts_audio_path_strict_check;
alter table public.drafts add constraint drafts_audio_path_strict_check
  check (
    audio_path is null
    or (
      audio_path ~ ('^' || user_id::text || '/drafts/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$')
      and audio_path !~ '(^|/)\.{1,2}(/|$)'
    )
  ) not valid;

do $$
begin
  if exists (
    select 1 from public.drafts
    where audio_path is not null
      and not (
        audio_path ~ ('^' || user_id::text || '/drafts/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$')
        and audio_path !~ '(^|/)\.{1,2}(/|$)'
      )
  ) then
    raise notice 'drafts_audio_path_strict_check left NOT VALID: some existing drafts have an audio_path that breaks it';
  else
    alter table public.drafts validate constraint drafts_audio_path_strict_check;
  end if;
end $$;
