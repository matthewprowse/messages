-- Per-user caps on requests from the app that cost worker time, mail provider calls or Gemini (security audit
-- 2026-11-03, Low, unbounded user-driven cost). Enforced here so a changed or buggy client cannot run them up. The
-- workers (service role) are never limited. The limits are generous on purpose: far above what a person clicking in the
-- app reaches, low enough that a script cannot run up a bill.
--
--   * automation_previews: 50 a day ("In the last 30 days this would have made N leads": each one reads 30 days of mail
--     and may call Gemini).
--   * email_originals: 1000 a day (each one fetches an email's original from the mailbox provider).
--   * automations: at most 100 per person at any time (each enabled one runs on every new email).
--
-- The app deletes a preview and an original as soon as it has read the answer, so counting their rows would count
-- nothing. The daily caps are counted in rate_limits instead (20261102200000, through rate_limit_hit, one fixed UTC day
-- per window, keyed by kind and user id only, cleaned up after a day). A refused request rolls its own count back with
-- it. Refused with SQLSTATE 54000 and a stable message (automation_preview_limit, email_original_limit,
-- automation_limit), as the brief cap does (20261028110300); the app already shows its usual failure for each.

-- Counts one app request of this kind for this user and refuses it past the day's cap.
create function public.limit_daily_requests() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_kind text := tg_argv[0];
  v_cap integer := tg_argv[1]::integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  if public.rate_limit_hit('db:' || v_kind || ':' || new.user_id::text, v_cap, 86400) > 0 then -- 86400 s: one UTC day
    raise exception '%_limit', v_kind
      using errcode = '54000', hint = format('At most %s of these can be asked for in a day.', v_cap);
  end if;
  return new;
end;
$$;
revoke execute on function public.limit_daily_requests() from public, anon, authenticated;

create trigger automation_previews_daily_cap before insert on public.automation_previews
  for each row execute function public.limit_daily_requests('automation_preview', '50');
create trigger email_originals_daily_cap before insert on public.email_originals
  for each row execute function public.limit_daily_requests('email_original', '1000');

-- At most 100 automations per person.
create function public.limit_automations() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_cap constant integer := 100;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  -- One insert at a time per user, so two at once cannot both slip under the cap.
  perform pg_advisory_xact_lock(hashtextextended('automations:' || new.user_id::text, 0));
  if (select count(*) from public.automations a where a.user_id = new.user_id) >= v_cap then
    raise exception 'automation_limit' using errcode = '54000', hint = 'At most 100 automations can be kept.';
  end if;
  return new;
end;
$$;
revoke execute on function public.limit_automations() from public, anon, authenticated;

create trigger automations_cap before insert on public.automations
  for each row execute function public.limit_automations();
