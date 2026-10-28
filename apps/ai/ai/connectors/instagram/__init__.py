"""Instagram direct messages, as a process of its own:
python3 -m ai instagram, or pnpm instagram from the repo root.

Direct threads are stored the way the sync worker stores WhatsApp chats (threads with channel 'instagram',
their messages, attachments, contacts and contact identities) through public.ingest_instagram. The inbox
is read every few minutes with jitter, and less often when nothing is happening. Nothing is ever sent on
its own: replies go out only from the outbox, and a thread is marked seen only when you open it in the app.
A challenge, a sign-out or a ban stops the account with a plain reason until you connect it again.

Two kinds of account share this connector and its tables, told apart by the kind in the saved credentials. A
personal account signs in with its username and password through instagrapi (sync, signin, client). A Business
or Creator account signs in with Instagram Login on instagram.com and is read and answered through Instagram's
official API (official, official_mapping, graph), with a 24-hour window for replies and no instagrapi at all.

Modules: mapping turns Instagram's JSON into what is stored (pure), backoff decides how long to wait
(pure), signin runs a sign-in with its codes, store talks to Supabase, sync runs one account, and run
keeps one thread per connected account. credentials tells the kinds apart and picks an account's proxy."""
