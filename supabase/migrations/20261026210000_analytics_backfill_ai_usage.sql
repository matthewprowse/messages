-- The AI usage recorded before analytics existed, copied in as ai_call events so the Analytics page's spend
-- matches Settings, Usage. Copied once (it does nothing if they are already there). They carry no time taken
-- and a prompt of before_tracking, and the page leaves them out of the speed numbers.
insert into public.analytics_events (at, user_hash, name, props)
select u.created_at,
       public.analytics_user_hash(u.user_id),
       'ai_call',
       public.analytics_clean_props(jsonb_build_object(
         'feature', u.feature,
         'model', u.model,
         'prompt', 'before_tracking',
         'ok', true,
         'in_tok', u.input_tokens,
         'out_tok', u.output_tokens,
         'cached_pct', case when u.input_tokens > 0 then round(100.0 * u.cached_tokens / u.input_tokens) else 0 end,
         'cost_micro', round(u.cost_usd * 1000000),
         'attempts', 1))
from public.ai_usage u
where coalesce((select share_usage from public.profiles p where p.user_id = u.user_id), true)
  and not exists (select 1 from public.analytics_events e where e.name = 'ai_call' and e.props ->> 'prompt' = 'before_tracking');
