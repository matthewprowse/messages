-- A small sealed preview for an attachment, stored in the attachments bucket, so lists can show a thumbnail
-- without downloading the full file. thumb_path is the object path; null means no thumbnail yet. The worker writes
-- it and the app reads it. No policy, grant or view needs to change: attachments has table level grants and row
-- policies (not column lists), and the shared attachment functions return whole rows (setof public.attachments),
-- so the new column is readable under the same row security as the rest.
-- Adding a nullable column with no default only changes the catalog, so it is instant on a large table.

alter table public.attachments add column if not exists thumb_path text;
