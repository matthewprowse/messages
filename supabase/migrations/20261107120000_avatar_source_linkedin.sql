-- LinkedIn profile pictures can be a contact's photo, like WhatsApp's: they fill in where there is none and
-- give way to a photo from your address book (iCloud or Google Contacts).
alter table public.contacts drop constraint if exists contacts_avatar_source_check;
alter table public.contacts add constraint contacts_avatar_source_check
  check (avatar_source in ('icloud', 'google', 'whatsapp', 'linkedin'));
