-- The four share_followup_on_* functions only run as triggers. They were executable by anon and authenticated
-- through /rest/v1/rpc, which does nothing useful but is open for no reason (found by the Supabase security advisor
-- after 20261101120000_shared_chats.sql was applied). Applied to the live database on 27 October 2026.
revoke execute on function
  public.share_followup_on_message(),
  public.share_followup_on_message_ai(),
  public.share_followup_on_attachment(),
  public.share_followup_on_thread()
from public, anon, authenticated;
