-- Bounce and delivery reports carry parts that are the email itself (the returned message's headers,
-- the delivery status), not files. They join AMP copies of the body under hidden_reason 'inline'.
-- The sync worker hides them for new mail; this catches the rows stored before.
update public.attachments
set hidden = true, hidden_reason = 'inline'
where (hidden_reason is null or hidden_reason = 'junk')
  and lower(coalesce(mime_type, '')) in ('text/rfc822-headers', 'message/delivery-status', 'message/disposition-notification');
