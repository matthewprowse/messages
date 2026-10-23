-- The one-off job that encrypted text stored before encryption is done and checked, so its write
-- function goes. To run apps/worker/scripts/encrypt-existing.ts again (--decrypt included), re-apply
-- 20261024180000_encrypt_existing_write.sql first.
drop function if exists public.encrypt_existing_write(text, jsonb);
