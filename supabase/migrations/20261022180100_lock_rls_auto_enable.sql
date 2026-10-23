-- rls_auto_enable is Supabase's event trigger that turns on row-level security for every new table.
-- It only needs to run as an event trigger, so nobody should be able to call it through the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
