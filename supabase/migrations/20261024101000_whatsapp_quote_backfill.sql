-- WhatsApp quoted replies stored before quotes had their own place: the quote was the first line of the
-- body, "> Author: text", followed by a blank line. It moves into provider_meta.quoted, the shape the
-- worker now stores ({id, author, from_me, text}), and leaves the body as what was actually written.
with quoted as (
  select
    m.id,
    substring(m.body_text from '^> ([^\n]*)') as line,
    nullif(regexp_replace(m.body_text, '^> [^\n]*(\n\n)?', ''), '') as rest
  from public.messages m
  join public.threads t on t.id = m.thread_id and t.channel = 'whatsapp'
  where m.provider_meta ? 'quoted_id' and m.body_text like '> %'
)
update public.messages m
set body_text = q.rest,
    provider_meta = (m.provider_meta - 'quoted_id') || jsonb_build_object('quoted', jsonb_build_object(
      'id', m.provider_meta->>'quoted_id',
      'author', split_part(q.line, ': ', 1),
      'from_me', split_part(q.line, ': ', 1) = 'You',
      'text', substr(q.line, length(split_part(q.line, ': ', 1)) + 3)
    ))
from quoted q
where q.id = m.id;

-- A quote with no text to show (the quoted message had none) keeps only what it points at.
update public.messages m
set provider_meta = (m.provider_meta - 'quoted_id') || jsonb_build_object('quoted', jsonb_build_object(
  'id', m.provider_meta->>'quoted_id', 'author', '', 'from_me', false, 'text', ''))
where m.provider_meta ? 'quoted_id';
