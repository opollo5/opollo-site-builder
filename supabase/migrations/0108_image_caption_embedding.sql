-- 0108 — image_library.caption_embedding (pgvector).
-- Reference: Spec 05 (featured-image suggestions hybrid ranking).
--
-- Adds a 1536-dim vector column storing the OpenAI text-embedding-3-small
-- representation of each image's caption + alt + tags + filename concatenation.
-- Hybrid ranking against this column blends with the existing GIN/tsvector
-- BM25-style search via Reciprocal Rank Fusion (RRF) at query time.
--
-- Design decisions encoded here:
--
-- 1. Column nullable. Existing 9k iStock rows + every new upload starts with
--    NULL until either the upload-time hook or the backfill script runs.
--    The query path treats NULL embeddings as semantic-rank-absent and
--    falls back to keyword-only ranking for those rows.
--
-- 2. HNSW index over `vector_cosine_ops`. Cosine matches the angular
--    similarity OpenAI's normalised vectors are designed for. HNSW is
--    Postgres pgvector's only ANN index that supports cosine; ivfflat
--    requires building from a populated set, which would force a
--    backfill-then-index two-step. HNSW indexes inserts incrementally so
--    we can add it now and let the backfill populate behind it.
--
-- 3. Dimension 1536 hard-coded. text-embedding-3-small produces 1536-dim
--    vectors; pgvector requires the column dimension at DDL time. Changing
--    the embedding model later requires a separate migration with a new
--    column or a column type change — that's a deliberate explicit step
--    rather than implicit truncation.
--
-- 4. Extension created in `extensions` schema (Supabase convention). The
--    `vector` TYPE is qualified to that schema in the column definition.
--
-- Write-safety hotspots addressed:
--   - No constraint on populated vs NULL — search degrades gracefully
--     instead of failing a row that hasn't been embedded yet.
--   - HNSW index is incremental; no offline rebuild step.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE image_library
  ADD COLUMN IF NOT EXISTS caption_embedding extensions.vector(1536);

-- HNSW index for ANN cosine search. m=16 / ef_construction=64 are pgvector
-- defaults documented for production workloads; tune later only with data.
CREATE INDEX IF NOT EXISTS idx_image_library_caption_embedding_hnsw
  ON image_library
  USING hnsw (caption_embedding extensions.vector_cosine_ops);
