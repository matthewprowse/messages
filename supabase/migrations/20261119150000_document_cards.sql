-- Document cards (docs/PLAN.md, Document Cards). The AI worker reads a PDF or an image that looks like a document and
-- keeps a card on the attachment: type (invoice, quote, contract, ID, statement, proof of payment, other), who it is
-- with, amount and currency, due date, reference and a one-line summary. The card is JSON sealed in the worker under the
-- field "doc_card", so only the owner's browser and the AI worker can read it.
--
-- It is made for files someone asks about (a row in document_reads) and for PDFs and document-like images that arrive from
-- people in the contacts list, never for newsletters, with a per-person daily cap in the worker. Its cost is filed under
-- its own feature ('documents') with its own share of the monthly budget.

alter table public.attachments
  add column doc_card text,
  add column doc_state text check (doc_state is null or doc_state in ('done', 'none', 'failed')),
  add column doc_read_at timestamptz,
  add column doc_by text check (doc_by is null or doc_by in ('auto', 'request'));

-- The worker's automatic pass: files not yet looked at, newest first; the cap per person counts what was read today.
create index attachments_doc_pending_idx on public.attachments (created_at desc)
  where doc_state is null and hidden = false and storage_path is not null and kind in ('pdf', 'image');
create index attachments_doc_read_idx on public.attachments (user_id, doc_read_at) where doc_read_at is not null;

-- A request to read one file, made from the app. The worker claims it, writes attachments.doc_card and deletes the
-- request. One it could not answer keeps a short error, so the app can say so and offer Retry.
create table public.document_reads (
  attachment_id uuid primary key references public.attachments (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  error text check (error is null or char_length(error) <= 300)
);

create index document_reads_open_idx on public.document_reads (created_at) where error is null;
create index document_reads_user_idx on public.document_reads (user_id);

alter table public.document_reads enable row level security;
revoke all on public.document_reads from anon;
revoke update, truncate on public.document_reads from authenticated;

create policy "document_reads_select_own" on public.document_reads
  for select to authenticated using (user_id = (select auth.uid()));

create policy "document_reads_insert_own" on public.document_reads
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and claimed_at is null and error is null
    and exists (select 1 from public.attachments a where a.id = attachment_id and a.user_id = (select auth.uid()) and a.kind in ('pdf', 'image'))
  );

-- Only a failed request may be removed by its owner, so Retry can ask again.
create policy "document_reads_delete_failed_own" on public.document_reads
  for delete to authenticated using (user_id = (select auth.uid()) and error is not null);

-- Its cost is filed under its own feature. The list is the one in 20261114100000_bulk_reads.sql plus 'documents'.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('triage', 'draft', 'learn', 'brief', 'transcribe', 'logos', 'bulk_read', 'documents'));

-- Starting split: 4% for document cards, taken from the largest share (never more than it has, so no share goes below 0),
-- and a weekly limit like the other on-request features. Only when the owner has no share for it yet, so a split already
-- set in Admin is left as it is. A share of zero would pause the feature for everyone, which is why it is set here.
do $$
declare
  v_shares jsonb;
  v_big text;
  v_take numeric;
begin
  select shares into v_shares from public.ai_budget limit 1;
  if v_shares is not null and not (v_shares ? 'documents') then
    select f.key into v_big from jsonb_each_text(v_shares) f order by f.value::numeric desc, f.key limit 1;
    v_take := least(4, greatest(coalesce((v_shares ->> v_big)::numeric, 0), 0));
    if v_big is not null then
      v_shares := jsonb_set(v_shares, array[v_big], to_jsonb((v_shares ->> v_big)::numeric - v_take));
    end if;
    update public.ai_budget set shares = jsonb_set(v_shares, '{documents}', to_jsonb(v_take));
  end if;
  update public.ai_budget set weekly_features = array_append(weekly_features, 'documents') where not ('documents' = any (weekly_features));
end $$;
