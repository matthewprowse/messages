-- Personalisation, round two.
-- 1. style_rules.source also allows 'signals': rules learned from the tones and instructions you pick on
--    drafts and from drafts you throw away.
-- 2. style_rules.disabled_reason says why a rule is off. 'user' means you turned it off and the AI never
--    turns it back on; 'unsupported' means the newest learning no longer found it in your mail, so it
--    comes back on if your mail supports it again. A trigger keeps it right, so the app only sets enabled.
-- 3. An index for the AI worker's embedding backfill.

alter table public.style_rules drop constraint style_rules_source_check;
alter table public.style_rules add constraint style_rules_source_check
  check (source in ('edits', 'sent_mail', 'manual', 'signals'));

alter table public.style_rules add column disabled_reason text
  check (disabled_reason in ('user', 'unsupported'));

-- On means no reason. Off without a reason means you turned it off. Already off keeps its reason.
create or replace function public.style_rules_disabled_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled then
    new.disabled_reason := null;
  elsif new.disabled_reason is null then
    new.disabled_reason := case
      when tg_op = 'UPDATE' and not old.enabled then coalesce(old.disabled_reason, 'user')
      else 'user'
    end;
  end if;
  return new;
end;
$$;

revoke execute on function public.style_rules_disabled_reason() from public, anon, authenticated;

create trigger style_rules_disabled_reason before insert or update of enabled, disabled_reason on public.style_rules
  for each row execute function public.style_rules_disabled_reason();

-- 3. The AI worker embeds the newest messages without an embedding first; this keeps finding them cheap.
create index messages_unembedded_idx on public.messages (sent_at desc) where embedding is null;
