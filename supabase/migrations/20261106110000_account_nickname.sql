-- A name the person gives an account ("Work", "Personal"). Kept apart from label so reconnecting, which
-- rewrites label, never loses it. Shown next to the service logo only when they have several of one service.
alter table public.accounts add column nickname text check (nickname is null or char_length(nickname) between 1 and 40);
grant update (nickname) on public.accounts to authenticated;
