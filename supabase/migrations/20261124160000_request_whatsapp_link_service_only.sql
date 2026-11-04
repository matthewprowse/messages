-- request_whatsapp_link(p_user, p_phone) is for the service role only (security audit 2026-11-03). It takes the user
-- as an argument, so anyone who could call it could start linking WhatsApp on another person's account.
--
-- 20261024090000_whatsapp_ingest.sql (the only migration that defines it) already revoked it from public, anon and
-- authenticated, and nothing granted it back. This repeats the revoke so the file states it on its own, as
-- 20261124140300_definer_hardening.sql does for the audit triggers. Its callers are unaffected: the web app calls
-- link_whatsapp(p_phone) (security definer, always for auth.uid()), and apps/worker/scripts/connect-whatsapp.ts uses
-- the service role.

revoke execute on function public.request_whatsapp_link(uuid, text) from public, anon, authenticated;
grant execute on function public.request_whatsapp_link(uuid, text) to service_role;
