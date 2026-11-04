-- Chosen company logos move to a public bucket, "company-logos", so the app shows each at one stable address that the
-- browser and the CDN keep for a year, instead of signing a new link (a new address, so a fresh download) on every
-- launch. Logos are public brand images, not anyone's data.
--
-- The sync worker writes them under content-addressed names, <SHA-256 of the domain>-<first 16 hex of the PNG's
-- SHA-256>.png (apps/worker/src/logos/paths.ts), with a year's Cache-Control: a new logo gets a new name, so nothing
-- cached goes stale, and a name cannot be worked out from a domain alone. Only the service role writes, and there is no
-- policy on storage.objects for this bucket, so nobody can list it; a public bucket serves a file to anyone who has its
-- address.
--
-- The owner's review files (candidates and judge's sheets under review/) stay in the private "logos" bucket, owner
-- only, as do chosen logos saved before this until the worker moves them (organizations.logo_path and
-- company_logos.path change with them). The app signs a path from "logos" unless it is a content-addressed name, so it
-- works before and after this migration and the move.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 5242880, array['image/png'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- When a company's logo gets a new name, the worker points every company at it by its old path at once.
create index if not exists organizations_logo_path_idx on public.organizations (logo_path) where logo_path is not null;
