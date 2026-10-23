-- Guided drafting. When a message needs a decision only the user can make ("Are you free Thursday at
-- 3?"), triage offers a few one-tap choices, and the draft is written from the one they pick.
--
-- message_ai.reply_choices: the choices for that message, encrypted (field "choices"), as JSON:
--   {"asked": "2026-10-29T15:00" | null, "minutes": 60 | null,
--    "options": [{"label": "Yes, Available", "decision": "I am free then.", "kind": "accept"}, ...]}
-- "asked" is the time they asked about, as written in the message. Null when the message was not
-- looked at for choices; {"options": []} when it was and none apply.
alter table public.message_ai add column reply_choices text;

-- drafts.decision: what the user decided, from the choice they picked plus anything they typed with it,
-- encrypted like drafts.instruction (field "instruction"). decision_kind is the picked option's kind, so
-- choices picked again and again can be learned from.
alter table public.drafts add column decision text;
alter table public.drafts add column decision_kind text
  check (decision_kind in ('accept', 'decline', 'other_time', 'answer'));

-- The choices backfill finds triaged messages that still need a reply and have not been looked at.
create index message_ai_choices_todo_idx on public.message_ai (user_id) where needs_reply and reply_choices is null;
