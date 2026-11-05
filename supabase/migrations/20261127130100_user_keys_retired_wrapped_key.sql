-- A retired data key is kept, wrapped, instead of deleted (security audit 2026-11-04, Low).
--
-- When a user's key rotation finishes (apps/worker/src/rekey), the previous key was set to null. Anything still
-- sealed under it (a value the clean pass counted unreadable and the operator accepted, or one a browser sealed with
-- stale keys after the pass began) was then lost for good. The retired key now moves to retired_wrapped_key, where
-- nothing seals with it and nothing opens with it by default; an operator can rewrap or open a stray value from it by
-- hand. Each retirement replaces it: only the last retired key is kept, as keys:rekey never runs twice without a clean
-- pass in between.

alter table public.user_keys
  add column if not exists retired_wrapped_key text,
  add column if not exists retired_wrapped_by text,
  add column if not exists retired_at timestamptz;

alter table public.user_keys drop constraint if exists user_keys_retired_pair;
alter table public.user_keys add constraint user_keys_retired_pair check ((retired_wrapped_key is null) = (retired_wrapped_by is null));
