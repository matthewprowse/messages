-- Service-role-only tables lose the app roles' table privileges (security audit 2026-11-03, Low, secret tables).
--
-- These tables hold sign-ins, sessions, sync cursors and internal queues. Each has RLS on and no policy, which already
-- refuses every row to anon and authenticated, but the default grants still gave both roles every privilege on them, so
-- one stray policy later (or TRUNCATE, which RLS does not cover) would open them. Revoking the privileges makes "service
-- role only" true twice over.
--
-- Nothing in the app or an app-run function needs them: the web app reads and writes account_credentials and mail_hints
-- with the service role (apps/web/lib/server, the connect routes, the Graph notify route), the workers use the service
-- role, and every SQL function that touches them (disconnect_account, link_whatsapp, delete_attachment_files,
-- rate_limit_hit) is security definer, so it runs as its owner.
--
-- mail_hints stays in the Realtime publication: the sync worker listens to it with the service role
-- (apps/worker/src/runtime/mail-hints.ts). Nothing in the web app subscribes to it, and without a grant or a policy no
-- signed-in person receives its events.

revoke all on public.account_credentials from anon, authenticated;
revoke all on public.whatsapp_auth_keys from anon, authenticated;
revoke all on public.sync_state from anon, authenticated;
revoke all on public.mail_hints from anon, authenticated;
revoke all on public.storage_deletions from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;
