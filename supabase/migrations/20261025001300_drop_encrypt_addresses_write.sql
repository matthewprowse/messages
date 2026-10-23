-- The address backfill has run (every stored address, number, chat ID and domain is encrypted), so its
-- temporary write function goes. To run apps/worker/scripts/encrypt-addresses.ts again (or --decrypt),
-- re-apply the function from 20261025001200_outbox_addresses.sql first.
drop function public.encrypt_addresses_write(text, jsonb);
