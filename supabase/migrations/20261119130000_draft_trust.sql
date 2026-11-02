-- Trustworthy drafts (Wave 5), docs/PLAN.md "Draft Facts, Feedback and Voice Replies".
--
-- 1. drafts.report: the fact guard's report (apps/ai/ai/drafts_facts.py), sealed like the draft body because it quotes
--    details from the draft. drafts.audit: counts of what the draft was written from, no text.
-- 2. drafts.feedback and feedback_reason: the thumbs up or down on a draft and an optional reason chip. A closed list, so
--    no free text; apps/ai/ai/signals.py reads them with the other learning signals.
-- 3. style_rules.channel: email rules no longer leak into WhatsApp drafts. Every rule learned so far came from email
--    (docs/PLAN.md: "all 11 learned rules are email rules"), so edit and sent-mail rules become email rules; tone and
--    manual rules stay for every channel.
-- 4. profiles.voice_whatsapp_learned_at and voice_whatsapp_learned_outbound: voice.py learns WhatsApp on its own
--    counters. The existing trigger that keeps the counters the AI worker's is extended to the two new columns.

alter table public.drafts
  add column report text,
  add column audit jsonb,
  add column feedback text check (feedback in ('up', 'down')),
  add column feedback_reason text check (feedback_reason in ('too_formal', 'too_casual', 'too_long', 'too_short', 'wrong_facts', 'wrong_language', 'not_like_me')),
  add column feedback_at timestamptz;

alter table public.style_rules
  add column channel text not null default 'any' check (channel in ('any', 'email', 'whatsapp'));
update public.style_rules set channel = 'email' where source in ('sent_mail', 'edits');
create index style_rules_channel_idx on public.style_rules (user_id, channel) where enabled;

alter table public.profiles
  add column voice_whatsapp_learned_at timestamptz,
  add column voice_whatsapp_learned_outbound integer not null default 0;

create or replace function public.profiles_keep_voice_counters() returns trigger
  language plpgsql set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' then
    if tg_op = 'INSERT' then
      new.voice_learned_at := null;
      new.voice_learned_outbound := 0;
      new.voice_whatsapp_learned_at := null;
      new.voice_whatsapp_learned_outbound := 0;
    else
      new.voice_learned_at := old.voice_learned_at;
      new.voice_learned_outbound := old.voice_learned_outbound;
      new.voice_whatsapp_learned_at := old.voice_whatsapp_learned_at;
      new.voice_whatsapp_learned_outbound := old.voice_whatsapp_learned_outbound;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_keep_voice_counters() from public, anon, authenticated;
