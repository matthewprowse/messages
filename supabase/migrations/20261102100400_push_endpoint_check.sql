-- A push endpoint will one day be fetched by a server, so it must be an https address on a real host name:
-- no plain http, no IPv4 or IPv6 literal, no localhost, .local or .internal names, no credentials in the URL.
-- NOT VALID applies the rule to new and changed rows without failing on any old row.
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_safe check (
  endpoint ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?(/|$)'
  and substring(endpoint from '^https://([^/:]+)') ~ '\.'
  and substring(endpoint from '^https://([^/:]+)') !~ '^[0-9.]+$'
  and lower(substring(endpoint from '^https://([^/:]+)')) !~ '(^localhost$|\.localhost$|\.local$|\.internal$|\.localdomain$)'
) not valid;
