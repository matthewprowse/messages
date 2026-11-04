-- Outside senders must not be able to spend a person's AI allowance with voice notes (security audit 2026-11-03).
--
-- 1. messages.transcript_status gains 'deferred': a voice note from a conversation the user has never written in is
--    not transcribed until they write there (the AI worker then puts it back in the queue by setting the status to
--    null) or ask for it in the app ('requested', set by request_transcription in 20261124150000, which the worker takes
--    ahead of the deferral but still under the conversation's daily cap and the budget).
-- 2. Voice notes are billed to their own feature, voice_notes, so a stream of them can no longer use up the share
--    meetings transcribe from ('transcribe'). The list is the one in 20261120110000_automations.sql plus 'voice_notes'.
-- 3. Starting split: voice_notes takes a third of the transcribe share (or 1 from the largest when transcribe has none),
--    with a weekly limit like transcribe. Only when the owner has no share for it yet, so a split set in Admin stays.
--    A share of zero would pause the feature for everyone, which is why one is set here.

alter table public.messages drop constraint if exists messages_transcript_status_check;
alter table public.messages add constraint messages_transcript_status_check
  check (transcript_status in ('done', 'silent', 'failed', 'deferred', 'requested'));

alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('triage', 'draft', 'learn', 'brief', 'transcribe', 'logos', 'bulk_read', 'documents', 'automations', 'voice_notes'));

do $$
declare
  v_shares jsonb;
  v_from text;
  v_take numeric;
begin
  select shares into v_shares from public.ai_budget limit 1;
  if v_shares is not null and not (v_shares ? 'voice_notes') then
    -- From transcribe when it has a share; otherwise 1 from the largest, as 20261120110000_automations.sql does.
    if coalesce((v_shares ->> 'transcribe')::numeric, 0) > 0 then
      v_from := 'transcribe';
      v_take := round((v_shares ->> 'transcribe')::numeric / 3, 1);
    else
      select f.key into v_from from jsonb_each_text(v_shares) f order by f.value::numeric desc, f.key limit 1;
      v_take := least(1, greatest(coalesce((v_shares ->> v_from)::numeric, 0), 0));
    end if;
    if v_from is not null then
      v_shares := jsonb_set(v_shares, array[v_from], to_jsonb((v_shares ->> v_from)::numeric - v_take));
    end if;
    update public.ai_budget set shares = jsonb_set(v_shares, '{voice_notes}', to_jsonb(coalesce(v_take, 0)));
  end if;
  update public.ai_budget set weekly_features = array_append(weekly_features, 'voice_notes') where not ('voice_notes' = any (weekly_features));
end $$;
