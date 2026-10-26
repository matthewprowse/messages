-- AI drafting in New Email and New WhatsApp. A draft there has no conversation yet: thread_id is null and
-- account_id says which account it goes out from, contact_id who it is to when they are a contact. An
-- email draft also gets a subject (sealed, FIELD subject). The AI worker reads what it needs with
-- compose_context, the same parts as draft_context without a conversation. When the message is sent,
-- outbox.draft_id carries the draft, and learning reads it once the conversation is filed.
alter table public.drafts alter column thread_id drop not null;
alter table public.drafts add column account_id uuid references public.accounts (id) on delete cascade;
alter table public.drafts add column contact_id uuid references public.contacts (id) on delete set null;
alter table public.drafts add column subject text;
alter table public.drafts add constraint drafts_target_check check (thread_id is not null or account_id is not null);

-- In one of your conversations, or with none, from one of your accounts, to one of your contacts.
drop policy "Drafts only in own conversations" on public.drafts;
create policy "Drafts only in own conversations" on public.drafts as restrictive for insert to authenticated
  with check (
    (
      (thread_id is not null and exists (select 1 from public.threads t where t.id = drafts.thread_id and t.user_id = (select auth.uid())))
      or (thread_id is null and exists (select 1 from public.accounts a where a.id = drafts.account_id and a.user_id = (select auth.uid())))
    )
    and (contact_id is null or exists (select 1 from public.contacts c where c.id = drafts.contact_id and c.user_id = (select auth.uid())))
  );

drop policy "Drafts stay in own conversations" on public.drafts;
create policy "Drafts stay in own conversations" on public.drafts as restrictive for update to authenticated
  with check (
    (
      (thread_id is not null and exists (select 1 from public.threads t where t.id = drafts.thread_id and t.user_id = (select auth.uid())))
      or (thread_id is null and exists (select 1 from public.accounts a where a.id = drafts.account_id and a.user_id = (select auth.uid())))
    )
    and (contact_id is null or exists (select 1 from public.contacts c where c.id = drafts.contact_id and c.user_id = (select auth.uid())))
  );

create or replace function public.compose_context(p_user uuid, p_account uuid, p_contact uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_channel text;
begin
  select case when a.provider = 'whatsapp' then 'whatsapp' else 'email' end into v_channel
  from public.accounts a
  where a.id = p_account and a.user_id = p_user;
  if v_channel is null then
    return jsonb_build_object('account', null);
  end if;

  return jsonb_build_object(
    'account', jsonb_build_object('id', p_account, 'user_id', p_user, 'channel', v_channel),
    'profile', (
      select jsonb_build_object('display_name', p.display_name, 'about', p.about)
      from public.profiles p where p.user_id = p_user
    ),
    'rules', (
      select coalesce(jsonb_agg(jsonb_build_object('rule', r.rule, 'scope', r.scope, 'contact_id', r.contact_id)
                                order by r.support_count desc, r.id), '[]'::jsonb)
      from (
        select rule, scope, contact_id, support_count, id from public.style_rules
        where user_id = p_user and enabled
        order by support_count desc, id
        limit 40
      ) r
    ),
    'facts', (
      select coalesce(jsonb_agg(jsonb_build_object('title', n.title, 'body', n.body) order by n.id), '[]'::jsonb)
      from (
        select id, title, body from public.notes
        where user_id = p_user and use_in_drafts
        order by id
        limit 15
      ) n
    ),
    'examples', (
      select coalesce(jsonb_agg(jsonb_build_object('situation', w.situation, 'body', w.body) order by w.created_at, w.id), '[]'::jsonb)
      from (
        select situation, body, created_at, id from public.writing_examples
        where user_id = p_user
        order by created_at, id
        limit 5
      ) w
    ),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object('body_text', m.body_text, 'body_html', m.body_html) order by m.sent_at desc, m.id), '[]'::jsonb)
      from (
        select om.body_text, om.body_html, om.sent_at, om.id from public.messages om
        join public.threads ot on ot.id = om.thread_id
        where om.user_id = p_user and om.direction = 'outbound' and ot.channel = v_channel
        order by om.sent_at desc, om.id
        limit 8
      ) m
    ),
    'contact', (
      select jsonb_build_object(
        'id', c.id, 'display_name', c.display_name, 'relationship', c.relationship, 'style_note', c.style_note,
        'ai_summary', c.ai_summary,
        'organizations', case when o.id is null then null else jsonb_build_object('name', o.name, 'summary', o.summary) end
      )
      from public.contacts c
      left join public.organizations o on o.id = c.organization_id and o.user_id = p_user
      where c.id = p_contact and c.user_id = p_user
    ),
    'to_them', (
      select coalesce(jsonb_agg(jsonb_build_object('body_text', m.body_text, 'body_html', m.body_html) order by m.sent_at desc), '[]'::jsonb)
      from (
        select om.body_text, om.body_html, om.sent_at from public.messages om
        join public.threads ot on ot.id = om.thread_id
        where p_contact is not null and om.user_id = p_user and om.direction = 'outbound' and ot.channel = v_channel
          and om.thread_id in (
            select tp.thread_id from public.thread_participants tp
            where tp.contact_id = p_contact and tp.user_id = p_user
            limit 30
          )
        order by om.sent_at desc
        limit 3
      ) m
    )
  );
end;
$$;

revoke execute on function public.compose_context(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.compose_context(uuid, uuid, uuid) to service_role;
