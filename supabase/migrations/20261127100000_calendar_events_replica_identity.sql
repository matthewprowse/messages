-- calendar_events stops broadcasting whole rows on delete (security audit 2026-11-04, Medium 1).
--
-- 20261117100000_calendar_events_realtime_and_range_index.sql set replica identity full so a DELETE carried user_id for
-- the page's Realtime filter. Realtime cannot apply row security to a DELETE, so with FULL identity the whole old row
-- (user id, account id, calendar id, provider event id, times, recurrence and the sealed columns as ciphertext, plaintext
-- for rows written before sealing) went to every signed-in subscriber that left the filter off. The filter is chosen by
-- the client, so it protected nothing.
--
-- Back to the default identity: a DELETE now carries the primary key only, as every other published table does. The
-- calendar page must handle deletes the way the threads channel does (apps/web/lib/app-store/use-realtime.ts): a
-- separate unfiltered DELETE subscription that acts only on ids it already holds. The user_id filter cannot match a
-- DELETE any more, because the old record no longer has that column.
--
-- Checked while writing this: calendar_events was the only published table with a replica identity other than the
-- default. email_originals publishes a column list (20261109100400), which keeps its primary key identity.

alter table public.calendar_events replica identity default;
