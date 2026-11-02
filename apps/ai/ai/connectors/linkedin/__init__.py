"""LinkedIn messaging for one account, as a process of its own the sync worker starts (python3 -m ai linkedin).

It speaks the JSON-lines protocol on stdin and stdout that apps/linkedin/README.md describes, so the worker
only changes the command it starts. It stores nothing, logs nothing and sends nothing it was not told to.
Unlike the Go helper it does not use linkedingo or any AGPL code: the LinkedIn calls live behind the
interface in client.py and are written from LinkedIn's own web traffic.

Modules: wire (error kinds and the response shapes), profile (who a first message is to, pure), files
(attachment checks and profile pictures), helper (the commands) and run (the stdin loop). client is the interface to
LinkedIn; factory, api, session, realtime, mapping and queries are its real implementation, built from the web app's own
traffic. Only the password sign-in is missing from it."""
