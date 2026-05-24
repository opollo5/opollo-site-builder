-- 0151 — Postgres 17 compatibility fix for hybrid_search_images.
--
-- Migration 0109 created hybrid_search_images using the `<=>` cosine-distance
-- operator from pgvector (installed in the `extensions` schema per Supabase
-- convention). On Postgres 15 (production) the operator resolves correctly.
-- On Postgres 17 (staging) operator lookup changed: without `extensions` in
-- the function's own search_path the `<=>` operator for `extensions.vector`
-- is not found, producing:
--   ERROR 42883: operator does not exist: extensions.vector <=> extensions.vector
--
-- Fix: recreate the function with `SET search_path TO extensions, public` in
-- the function options. This is safe on both Postgres 15 and 17 — the
-- explicit search_path is additive and doesn't change the function's
-- behaviour on production.
--
-- On staging this migration is applied after migration repair marks 0109 as
-- applied (to skip its incompatible version); on production 0109 is already
-- applied and this migration safely replaces the function.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hybrid_search_images(
  p_keyword_query  text,
  p_query_vector   extensions.vector(1536),
  p_limit          int DEFAULT 12,
  p_exclude_ids    uuid[] DEFAULT ARRAY[]::uuid[],
  p_pool_size      int DEFAULT 100
)
RETURNS TABLE (
  id              uuid,
  cloudflare_id   text,
  filename        text,
  title           text,
  caption         text,
  alt_text        text,
  tags            text[],
  hybrid_score    double precision,
  keyword_score   double precision,
  semantic_score  double precision
)
LANGUAGE sql
STABLE
SET search_path TO extensions, public
AS $$
  WITH keyword_results AS (
    SELECT il.id,
           ts_rank_cd(il.search_tsv, q.tsq)::double precision AS kw_score,
           ROW_NUMBER() OVER (ORDER BY ts_rank_cd(il.search_tsv, q.tsq) DESC, il.id ASC)::int AS kw_rank
    FROM image_library il
    CROSS JOIN LATERAL (
      SELECT plainto_tsquery('english', COALESCE(NULLIF(p_keyword_query, ''), 'a')) AS tsq
    ) q
    WHERE il.deleted_at IS NULL
      AND p_keyword_query IS NOT NULL
      AND p_keyword_query <> ''
      AND il.search_tsv @@ q.tsq
      AND NOT (il.id = ANY (COALESCE(p_exclude_ids, ARRAY[]::uuid[])))
    ORDER BY ts_rank_cd(il.search_tsv, q.tsq) DESC, il.id ASC
    LIMIT GREATEST(p_pool_size, p_limit)
  ),
  semantic_results AS (
    SELECT il.id,
           (1 - (il.caption_embedding <=> p_query_vector))::double precision AS sem_score,
           ROW_NUMBER() OVER (ORDER BY il.caption_embedding <=> p_query_vector ASC, il.id ASC)::int AS sem_rank
    FROM image_library il
    WHERE il.deleted_at IS NULL
      AND il.caption_embedding IS NOT NULL
      AND p_query_vector IS NOT NULL
      AND NOT (il.id = ANY (COALESCE(p_exclude_ids, ARRAY[]::uuid[])))
    ORDER BY il.caption_embedding <=> p_query_vector ASC, il.id ASC
    LIMIT GREATEST(p_pool_size, p_limit)
  ),
  blended AS (
    SELECT COALESCE(k.id, s.id) AS id,
           COALESCE(1.0 / (60 + k.kw_rank), 0) +
           COALESCE(1.0 / (60 + s.sem_rank), 0) AS hybrid_score,
           COALESCE(k.kw_score, 0) AS kw_score,
           COALESCE(s.sem_score, 0) AS sem_score
    FROM keyword_results k
    FULL OUTER JOIN semantic_results s USING (id)
  )
  SELECT il.id,
         il.cloudflare_id,
         il.filename,
         il.title,
         il.caption,
         il.alt_text,
         il.tags,
         b.hybrid_score::double precision AS hybrid_score,
         b.kw_score::double precision AS keyword_score,
         b.sem_score::double precision AS semantic_score
  FROM blended b
  JOIN image_library il ON il.id = b.id
  WHERE il.deleted_at IS NULL
  ORDER BY b.hybrid_score DESC, il.created_at DESC, il.id ASC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_search_images(text, extensions.vector, int, uuid[], int)
  TO service_role, authenticated;
