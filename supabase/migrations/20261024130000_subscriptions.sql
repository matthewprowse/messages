-- Subscriptions: junk you can unsubscribe from (newsletters, marketing, alerts), shown apart from the
-- rest of junk (spam, cold outreach). A conversation counts once any incoming message in it offers a
-- way out: a List-Unsubscribe header, or an unsubscribe link in the body, which the unsubscribe flow
-- falls back to. Some senders (LinkedIn job alerts, Pinterest, AliExpress) only have the body link.
alter table public.threads add column subscription boolean not null default false;

create or replace function public.message_marks_subscription(p_direction text, p_list_unsubscribe text, p_body_html text, p_body_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_direction = 'inbound'
    and (p_list_unsubscribe is not null or p_body_html ilike '%unsubscribe%' or p_body_text ilike '%unsubscribe%');
$$;

create or replace function public.subscription_on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.message_marks_subscription(new.direction, new.list_unsubscribe, new.body_html, new.body_text) then
    update public.threads set subscription = true where id = new.thread_id and not subscription;
  end if;
  return null;
end;
$$;

create trigger messages_mark_subscription
  after insert on public.messages
  for each row
  execute function public.subscription_on_message_insert();

revoke execute on function public.message_marks_subscription(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.subscription_on_message_insert() from public, anon, authenticated;

update public.threads t
set subscription = true
where not t.subscription
  and exists (
    select 1 from public.messages m
    where m.thread_id = t.id and public.message_marks_subscription(m.direction, m.list_unsubscribe, m.body_html, m.body_text)
  );
