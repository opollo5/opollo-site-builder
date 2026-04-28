-- 0030 — BP-7: featured-image plumbing for blog posts.
--
-- Two new columns on posts:
--
--   featured_image_id      uuid → image_library(id). The Opollo-side
--                          reference set when the operator picks an
--                          image in the BP-4 picker. ON DELETE SET NULL
--                          so an image_library cleanup doesn't cascade
--                          a post into invalid state — the post just
--                          becomes "needs a new featured image".
--
--   featured_wp_media_id   bigint. Stamped at publish time after the
--                          image transfers to WP /wp/v2/media. Re-publish
--                          reuses this id so we never re-upload the same
--                          image bytes twice for the same (post, image)
--                          pair. NULL until first publish.
--
-- Forward-only. Both columns nullable. Legacy posts (created via
-- brief-runner content_type='post' path) carry NULL on both — and the
-- runtime guard at publish time only fires when posts.metadata IS NOT
-- NULL (i.e. created via the BP-3 entry point).

ALTER TABLE posts
  ADD COLUMN featured_image_id uuid
    REFERENCES image_library(id) ON DELETE SET NULL,
  ADD COLUMN featured_wp_media_id bigint;

COMMENT ON COLUMN posts.featured_image_id IS
  'image_library row chosen as the featured image for this post. NULL when unset (entry-point posts must set this before publish; legacy brief-runner posts may stay NULL). Added 2026-04-27 (BP-7).';

COMMENT ON COLUMN posts.featured_wp_media_id IS
  'WP /wp/v2/media id assigned when the featured image was first transferred to WP. Re-publish reuses this id rather than re-uploading the same bytes. NULL until first publish. Added 2026-04-27 (BP-7).';
