-- instagram_sign_ins loses the app roles' table privileges (security audit 2026-11-04, "Not In Effect", Low).
--
-- 20261124140200_secret_table_grants.sql revoked the default grants from every service-role-only table (RLS on, no
-- policy) so a stray policy or TRUNCATE could never open one, but missed this table. It holds the sign-in step and the
-- sealed code for an Instagram or iCloud Reminders sign-in. The web app reads and writes it with the service role only
-- (apps/web/app/api/connect/instagram, apps/web/app/api/connect/icloud-reminders) and the AI worker's connectors use the
-- service role, so nothing in the app needs a grant.
--
-- Checked while writing this: every other table with RLS on and no policy (account_credentials, ai_batches, ai_claims,
-- ai_retries, ai_setup_grants, analytics_config, analytics_dropped, analytics_rate, attachment_fetch_state,
-- compliance_export_chats, compliance_exports, icloud_setups, mail_hints, message_embeddings, meta_webhook_hints,
-- rate_limits, storage_deletions, sync_state, team_keys, user_key_rotations, user_keys, whatsapp_auth_keys,
-- worker_leases, workspace_client_exclusions, workspace_contact_threads, workspace_invites) already has this revoke.

revoke all on table public.instagram_sign_ins from anon, authenticated;
