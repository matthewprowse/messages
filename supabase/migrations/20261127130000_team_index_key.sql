-- A team's blind-index key is stored on its own, so the first data key stops being handed to every member for good
-- (security audit 2026-11-04, Medium 6).
--
-- A team's blind indexes (who a shared client is, which chat is which) are made with a key derived from the team's
-- first data key, and must stay the same across rotations or every indexed value would be added twice. Until now the
-- raw first data key itself was handed to every member as the "index key", including people who joined after it was
-- retired: with a backup or a copy of old ciphertext, everything sealed under version 1 was theirs to read. User keys
-- already keep a derived HMAC key apart (user_keys.index_wrapped_key, 20261125130000); teams now do the same.
--
--   index_wrapped_key, index_wrapped_by  on the first version's row: the derived index key (HKDF of the first data
--                                        key with the team index info, exactly what members derived for themselves),
--                                        wrapped like the data keys, with the wrapper that made it.
--
-- The sync worker writes it the first time it opens a team's keys (packages/crypto/src/wrap.ts teamKeyring); from
-- then on the web app, the worker and the AI worker hand out or use that key and never the raw first data key once it
-- is retired. Members' existing indexes keep matching, as the bytes are the same ones they derived.

alter table public.team_keys
  add column if not exists index_wrapped_key text,
  add column if not exists index_wrapped_by text;

alter table public.team_keys drop constraint if exists team_keys_index_pair;
alter table public.team_keys add constraint team_keys_index_pair check ((index_wrapped_key is null) = (index_wrapped_by is null));
