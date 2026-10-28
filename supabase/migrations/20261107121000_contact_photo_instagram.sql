-- Instagram profile pictures as contact photos. The Instagram connector saves them in the private "avatars"
-- bucket at <user id>/<contact id>, like the sync worker's, with avatar_source 'instagram'. They rank with
-- WhatsApp photos: they fill in where a contact has none and never replace one from the address book.
-- The check on avatar_source is widened in place, whatever the column's constraint was called.

do $$
declare
  v_name text;
  v_def text;
begin
  select c.conname, pg_get_constraintdef(c.oid) into v_name, v_def
  from pg_constraint c
  where c.conrelid = 'public.contacts'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%avatar_source%';
  if v_name is not null and v_def not like '%''instagram''%' then
    execute format('alter table public.contacts drop constraint %I', v_name);
    -- Added to whatever the check allows now, so another connector's source stays.
    execute format('alter table public.contacts add constraint %I ', v_name)
      || regexp_replace(v_def, 'ARRAY\[', 'ARRAY[''instagram''::text, ');
  end if;
end;
$$;
