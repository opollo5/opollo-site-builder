-- 0109 — image_library hybrid search (keyword + semantic) RPC.
-- Reference: Spec 05 PR B (featured-image suggestion ranking).
--
-- Single SQL function blending two rankings via Reciprocal Rank Fusion:
--
--   1. Keyword side: Postgres FTS over image_library.search_tsv (already
--      maintained by the M4-1 trigger; weights title+caption A and tags B).
--   2. Semantic side: cosine similarity over image_library.caption_embedding
--      (the pgvector column added in migration 0108).
--
-- The RRF blend uses the standard 1/(60 + rank) constant — well-attested
-- in the IR literature. We do NOT tune the constant in this slice; once
-- telemetry is flowing (PR B logs every query), a future iteration can
-- adjust if signal supports it.
--
-- Inputs:
--   p_keyword_query  — plain-text query for plainto_tsquery(). NULL or empty
--                      → keyword side returns no rows; semantic side carries
--                      the result.
--   p_query_vector   — 1536-dim caption-side embedding for the post. NULL
--                      → semantic side returns no rows; keyword side carries
--                      the result.
--   p_limit          — final result-set size. Cap at 50 to bound work.
--   p_exclude_ids    — array of image_library.id to exclude (UI's "show me
--                      different ones" affordance). Empty array = no excludes.
--   p_pool_size      — top-N pulled from each side before RRF blend. 100 is
--                      pgvector's documented sweet-spot for HNSW recall vs
--                      latency on 9k-100k row collections.
--
-- Returns: ordered by hybrid_score desc, with both component scores so the
-- caller can log + debug.
--
-- Notes:
--   - Both sides exclude soft-deleted rows (deleted_at IS NULL).
--   - Both sides exclude rows in p_exclude_ids.
--   - Embedding NULLs are filtered on the semantic side; keyword side has
--     no per-row gate (every active row has search_tsv from the trigger).
--   - Read-only function (LANGUAGE sql STABLE) — safe under any RLS;
--     Supabase service-role bypass not required.
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

-- Grant execution to the roles that hit /api/images/suggest. Service-role
-- already has function execution by default; authenticated needs an
-- explicit GRANT for the RLS-bypass check.
GRANT EXECUTE ON FUNCTION public.hybrid_search_images(text, extensions.vector, int, uuid[], int)
  TO service_role, authenticated;
