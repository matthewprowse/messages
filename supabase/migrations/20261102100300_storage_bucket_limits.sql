-- File size limits on every bucket, so one upload cannot be arbitrarily large. Attachments stay at 50 MB
-- (the existing app limit) and keep no type list: the browser uploads sealed bytes as application/octet-stream
-- and incoming mail carries any type. The other buckets are written by the workers with known types; sealed
-- files are octet-stream, so that stays allowed.
update storage.buckets set file_size_limit = 52428800 where id = 'attachments';
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'application/octet-stream']
  where id = 'avatars';
update storage.buckets set file_size_limit = 52428800,
  allowed_mime_types = array['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'text/plain', 'application/octet-stream']
  where id = 'brief-audio';
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream']
  where id = 'logos';
