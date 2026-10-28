-- Message embeddings, sealed. Part B of two: removes the readable vectors.
--
-- APPLY ONLY AFTER THE EMBED BACKFILL HAS RUN. Order: part A (20261102800000_sealed_message_embeddings.sql),
-- deploy the AI worker, run `python3 -m ai.seal_embeddings --apply` until it reports nothing left, then this.
-- The check below refuses to run while any row still has a readable vector and no sealed one, so a
-- forgotten backfill cannot lose embeddings. Nothing in the app or workers reads message_embeddings.embedding
-- or similar_replies() any more (draft_context stopped calling it in part A).

do $$
declare
  v_left bigint;
begin
  select count(*) into v_left
  from public.message_embeddings
  where embedding is not null and embedding_data is null;
  if v_left > 0 then
    raise exception 'Embed backfill has not run: % rows still have a readable vector and no sealed one. Run python3 -m ai.seal_embeddings --apply first.', v_left;
  end if;
end;
$$;

drop function if exists public.similar_replies(uuid, extensions.vector, int, uuid);
drop function if exists public.similar_replies(uuid, extensions.vector, int);

drop index if exists public.message_embeddings_embedding_idx;
drop index if exists public.message_embeddings_pending_idx;
alter table public.message_embeddings drop column embedding;

-- Counts sealed vectors only now.
create or replace function public.embedded_message_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.message_embeddings
  where user_id = (select auth.uid()) and embedding_data is not null;
$$;

revoke execute on function public.embedded_message_count() from public, anon;
grant execute on function public.embedded_message_count() to authenticated;
