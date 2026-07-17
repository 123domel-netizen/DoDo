-- KOMUNIKATOR (CHAT4): wyszukiwarka globalna — FTS (simple + unaccent) + trigram.
-- Postgres nie ma konfiguracji 'polish'; unaccent neutralizuje diakrytykę,
-- pg_trgm łapie fragmenty słów i literówki.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Kolumny generowane wymagają funkcji IMMUTABLE — unaccent jest tylko STABLE,
-- więc opakowujemy ze stałym słownikiem (bezpieczne: słownik się nie zmienia).
create or replace function public.f_unaccent(p_text text)
returns text
language sql immutable parallel safe strict
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_text);
$$;

alter table public.messages
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple', public.f_unaccent(coalesce(body, '')))
  ) stored;

create index if not exists messages_search_idx
  on public.messages using gin (search_tsv);
create index if not exists messages_body_trgm_idx
  on public.messages using gin (body extensions.gin_trgm_ops);

alter table public.items
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector(
      'simple',
      public.f_unaccent(coalesce(title, '') || ' ' || coalesce(description, ''))
    )
  ) stored;

create index if not exists items_search_idx
  on public.items using gin (search_tsv);
create index if not exists items_title_trgm_idx
  on public.items using gin (title extensions.gin_trgm_ops);

-- RPC wyszukiwarki — SECURITY INVOKER: RLS naturalnie filtruje wyniki
-- (wiadomości tylko z moich rozmów, itemy tylko moje/SHARE).
create or replace function public.search_all(p_query text, p_limit int default 20)
returns table (
  result_type text,
  id uuid,
  conversation_id uuid,
  item_id uuid,
  title text,
  snippet text,
  created_at timestamptz,
  rank real
)
language sql stable
as $$
  with q as (
    select
      websearch_to_tsquery('simple', public.f_unaccent(coalesce(p_query, ''))) as tsq,
      public.f_unaccent(coalesce(p_query, '')) as raw
  )
  (
    select
      'message'::text,
      m.id,
      m.conversation_id,
      null::uuid,
      null::text,
      left(m.body, 200),
      m.created_at,
      ts_rank(m.search_tsv, q.tsq)::real
    from public.messages m
    cross join q
    where m.deleted_at is null
      and m.kind = 'text'
      and (
        m.search_tsv @@ q.tsq
        or public.f_unaccent(m.body) ilike '%' || q.raw || '%'
      )
    order by m.created_at desc
    limit p_limit
  )
  union all
  (
    select
      'item'::text,
      i.id,
      null::uuid,
      i.id,
      i.title,
      left(i.description, 200),
      i.created_at,
      ts_rank(i.search_tsv, q.tsq)::real
    from public.items i
    cross join q
    where i.deleted_at is null
      and (
        i.search_tsv @@ q.tsq
        or public.f_unaccent(i.title) ilike '%' || q.raw || '%'
      )
    order by i.created_at desc
    limit p_limit
  )
  union all
  (
    select
      'file'::text,
      ma.id,
      m.conversation_id,
      null::uuid,
      ma.file_name,
      null::text,
      ma.created_at,
      0::real
    from public.message_attachments ma
    join public.messages m on m.id = ma.message_id
    cross join q
    where m.deleted_at is null
      and public.f_unaccent(ma.file_name) ilike '%' || q.raw || '%'
    order by ma.created_at desc
    limit p_limit
  );
$$;

grant execute on function public.search_all(text, int) to authenticated;
