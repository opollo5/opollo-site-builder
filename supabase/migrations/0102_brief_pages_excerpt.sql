-- 0102 — Add excerpt column to brief_pages.
--
-- PB-1: operators can include a `### Excerpt` H3 section in a brief page's
-- body. The parser extracts it into BriefPageDraft.excerpt; this column
-- stores it so the approve-page bridge can write it to posts.excerpt, which
-- the publish route forwards to the WP REST API and Yoast SEO meta.
--
-- The 300-char cap mirrors POST_META_DESCRIPTION_MAX in lib/brief-runner.ts
-- and matches the WP REST excerpt outer bound.

ALTER TABLE brief_pages
  ADD COLUMN excerpt text
    CHECK (excerpt IS NULL OR char_length(excerpt) <= 300);
