-- Each company points at its shared logo (public.company_logos, the "logos" bucket). Domains are sealed per
-- user, so the app cannot look a company's logo up by domain itself; the sync worker opens them and keeps
-- this in step with company_logos.path (apps/worker/src/logos/job.ts). Null shows the first letter.

alter table public.organizations add column logo_path text;
