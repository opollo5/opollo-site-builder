-- 0029 — BP-3: posts.metadata jsonb column for the blog-post entry-point.
--
-- The new /admin/sites/[id]/posts/new entry-point parses metadata
-- (title, slug, meta_title, meta_description, source_map) from the
-- operator's pasted content via lib/blog-post-parser.ts. The
-- structured snapshot is persisted alongside the operator-confirmed
-- title/slug/excerpt so a later debugger can answer "what did the
-- smart-parser pull vs what did the operator type?" without
-- re-parsing.
--
-- Nullable: legacy posts (created via the brief-runner content_type
-- ='post' path) carry no parser metadata and stay NULL.
--
-- Forward-only. No backfill — operator-confirmed values already live
-- in title/slug/excerpt; metadata is the parsed-source provenance,
-- only meaningful for posts created via the new entry-point.

ALTER TABLE posts
  ADD COLUMN metadata jsonb;

COMMENT ON COLUMN posts.metadata IS
  'Snapshot of the smart-parser output (title, slug, meta_title, meta_description, source_map) for posts created via the BP-3 entry-point at /admin/sites/[id]/posts/new. NULL for posts created via the brief-runner path. Added 2026-04-27 (BP-3).';
