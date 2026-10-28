-- A language for what the AI writes about you (summaries, the brief): null means follow how you write,
-- conversation by conversation. And a way to hide a contact from the Contacts list without deleting them.
alter table public.profiles add column language text check (language in ('en-GB', 'en-US', 'af'));
alter table public.contacts add column hidden boolean not null default false;
