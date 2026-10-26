-- Note excerpts: the first words of a note's body, kept beside it so the notes list can load without
-- downloading every body.
--
-- The browser writes it with the body on every save and encrypts it like the title and body when content
-- encryption is on. Null means not written yet (notes saved before this): the app works it out from the
-- body once and saves it. The app keeps it short (a few hundred characters before sealing); the limit here
-- leaves room for the ciphertext.

alter table public.notes add column if not exists excerpt text;

alter table public.notes drop constraint if exists notes_excerpt_check;
alter table public.notes add constraint notes_excerpt_check check (char_length(excerpt) <= 4000);
