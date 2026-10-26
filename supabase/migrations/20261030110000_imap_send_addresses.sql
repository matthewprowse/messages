-- Any IMAP and SMTP mailbox (provider 'imap'): like iCloud, the server cannot list the addresses you may send
-- from, so you list them yourself in Settings. App users could edit send_addresses on iCloud accounts only;
-- now on IMAP accounts too. The function is otherwise exactly as 20261025000900_encrypted_address_safety.sql
-- left it.

create or replace function public.normalise_send_addresses()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.send_addresses := array(
    select case when u.a like 'e1:%' then u.a else lower(btrim(u.a)) end
    from unnest(new.send_addresses) with ordinality as u (a, i)
    where btrim(u.a) <> ''
    group by case when u.a like 'e1:%' then u.a else lower(btrim(u.a)) end
    order by min(u.i)
  );
  if tg_op = 'UPDATE' and current_user = 'authenticated' and new.provider not in ('icloud', 'imap')
     and new.send_addresses is distinct from old.send_addresses then
    raise exception 'send addresses can only be edited on iCloud and IMAP accounts' using errcode = '42501';
  end if;
  return new;
end;
$$;
