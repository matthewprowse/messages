-- Daily caps on the two remaining app requests that each cost a Gemini call (security audit 2026-11-04, Low).
--
-- 20261124140500_request_caps.sql capped automation previews and email originals. Document reads (a card for an
-- attachment) and bulk reads (Readable Bulk Email) were left to the user's AI allowance alone, so a script could spend
-- a whole month's share in minutes. Same trigger, same counting in rate_limits, same error shape (SQLSTATE 54000,
-- document_read_limit and bulk_read_limit), so the app shows its usual failure. The caps are far above a person's
-- clicking: 500 cards and 300 readable emails a day. The workers (service role) are never limited.

create trigger document_reads_daily_cap before insert on public.document_reads
  for each row execute function public.limit_daily_requests('document_read', '500');
create trigger bulk_reads_daily_cap before insert on public.bulk_reads
  for each row execute function public.limit_daily_requests('bulk_read', '300');
