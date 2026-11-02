-- Wave 5 triage: auto labels, the reason behind a label, and a flag for suspicious mail.
--
-- Auto labels: a user marks up to 6 of their labels Auto and describes each in a line. The description is the user's
-- own text, so the browser seals it with their key (field "name", like the label name). Triage reads them and picks at
-- most one per conversation in the same call as the rest of its answer. thread_labels.auto says the AI put it there.
-- A label taken off a conversation leaves a row in thread_label_removals so triage does not put it back; a trigger
-- writes it, so the app needs no extra call, and it is skipped when the label or the conversation is itself being deleted.
--
-- Reason: triage_reason is a code from a closed list (kept plain, it is not the user's text) and triage_reason_text is
-- a few words in the user's language, sealed like the summary. suspicious is a code for likely phishing or payment
-- change fraud, or null. They sit on message_ai (per message) and on threads (the latest incoming message decides).
-- Nothing acts on suspicious: the app only shows a warning.

alter table public.labels
  add column auto boolean not null default false,
  add column auto_description text;

alter table public.thread_labels add column auto boolean not null default false;

create function public.limit_auto_labels() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.auto and (select count(*) from public.labels l where l.user_id = new.user_id and l.auto and l.id <> new.id) >= 6 then
    raise exception 'At most 6 labels can be Auto' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger labels_limit_auto before insert or update of auto on public.labels
  for each row execute function public.limit_auto_labels();

create table public.thread_label_removals (
  thread_id uuid not null,
  label_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (thread_id, label_id)
);

alter table public.thread_label_removals enable row level security;
create policy "Own label removals" on public.thread_label_removals for select to authenticated
  using (user_id = (select auth.uid()));

create function public.note_label_removal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- A cascade from a deleted label or conversation runs this too; the parent is already gone, so nothing is kept.
  if exists (select 1 from public.labels where id = old.label_id) and exists (select 1 from public.threads where id = old.thread_id) then
    insert into public.thread_label_removals (thread_id, label_id, user_id) values (old.thread_id, old.label_id, old.user_id)
      on conflict (thread_id, label_id) do update set removed_at = now();
  end if;
  return old;
end;
$$;

create trigger thread_labels_note_removal after delete on public.thread_labels
  for each row execute function public.note_label_removal();

-- A label put back by hand (or by Undo) is no longer removed.
create function public.clear_label_removal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.thread_label_removals where thread_id = new.thread_id and label_id = new.label_id;
  return new;
end;
$$;

create trigger thread_labels_clear_removal after insert on public.thread_labels
  for each row execute function public.clear_label_removal();

alter table public.message_ai
  add column triage_reason text check (triage_reason is null or length(triage_reason) <= 40),
  add column triage_reason_text text,
  add column suspicious text check (suspicious in ('payment_change', 'phishing', 'impersonation'));

alter table public.threads
  add column triage_reason text check (triage_reason is null or length(triage_reason) <= 40),
  add column triage_reason_text text,
  add column suspicious text check (suspicious in ('payment_change', 'phishing', 'impersonation'));

-- "Not Right?" on a Needs Reply tag: this conversation does not need a reply.
alter table public.feedback drop constraint feedback_value_check;
alter table public.feedback add constraint feedback_value_check
  check (value in ('important', 'not_important', 'junk', 'not_junk', 'no_reply_needed'));
