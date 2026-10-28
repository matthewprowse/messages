"""iCloud Reminders through iCloud.com's own web sign-in, with no Mac, as a process of its own:
python3 -m ai icloud-reminders (pip3 install -r apps/ai/requirements-icloud-reminders.txt first).

The person types their Apple ID and password in the app; this signs in the way icloud.com does (SRP, then
two-factor), asks the app for the code Apple sends, and keeps the trusted session (cookies and trust
token) encrypted. The password is dropped once the session is trusted. Reminders are read through
pyicloud's CloudKit client, with delta sync from the zone's sync token, and stored in public.tasks the way
Microsoft To Do and Google Tasks are. Ticks made in the app (public.task_updates) are applied in iCloud.
When Apple ends the session the account shows Reconnect and the same form comes back.

Modules: mapping turns pyicloud's reminders into task rows (pure), backoff decides what an error means
and how long to wait (pure), signin runs a sign-in with its codes, session keeps pyicloud's session files
encrypted between runs, store talks to Supabase, sync runs one account, and run keeps one thread per
connected account."""
