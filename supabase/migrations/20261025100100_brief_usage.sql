-- The spoken daily brief records its Gemini usage (script and speech) as its own feature.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in ('triage', 'draft', 'learn', 'brief'));
