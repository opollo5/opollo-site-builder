-- 0019 — M13-1 posts schema.
-- Reference: docs/plans/m13-parent.md §M13-1.
--
-- Design decisions encoded here:
--
-- 1. Dedicated `posts` table mirrors `pages` for the generative columns
--    (content_brief, content_structured, generated_html,
--    design_system_version) and adds post-specific fields (excerpt,
--    published_at, author_id). The runner's `mode: 'page' | 'post'`
--    dispatch in M13-3 writes here when mode = 'post'. Sharing the
--    pages shape by field convention keeps the runner's per-mode
--    helpers near-symmetric; forking into a single "content" table
--    would have forced a content_type discriminator throughout every
--    M6/M7 query that currently assumes pages-only.
--
-- 2. content_type is CHECK-constrained to 'post'. The axis is legible
--    without a JOIN: any row in `posts` is a post by schema assertion.
--    Pages do not get the column in this migration — they are "post-
--    negative" by table identity. If posts + pages unify later, the
--    CHECK widens to IN ('page', 'post') and a data-migration backfills
--    the pages side.
--
-- 3. wp_post_id is nullable. A post is created as a draft inside
--    Opollo before WordPress assigns an id; the M13-4 publish action
--    writes wp_post_id + status='published' in one UPDATE. The partial
--    UNIQUE `(site_id, wp_post_id) WHERE wp_post_id IS NOT NULL`
--    mirrors M3-1's posts-side equivalent: NULL is distinct, so many
--    drafts coexist, but once published the pair must be unique.
--
-- 4. (site_id, slug) partial UNIQUE `WHERE deleted_at IS NULL`. A post
--    belongs to a site's URL namespace; two live posts with the same
--    slug would be a 404 or a random-winner at the WP side. Soft-
--    deleted rows don't contend. M3-1's `pages_site_slug_unique` is
--    the cross-slice precedent; we take the partial flavour here so
--    restoring a soft-deleted post from archive doesn't trip on a
--    new live sibling.
--
-- 5. status CHECK accepts 'draft' | 'published' | 'scheduled'. The
--    'scheduled' value lands in the schema NOW so M13-5 can ship the
--    scheduler surface without a follow-up migration. The parent plan
--    §Out-of-scope explicitly defers wiring scheduled publish to the
--    runner — the CHECK is forward-facing only today.
--
-- 6. Soft-delete + audit columns + version_lock per
--    docs/DATA_CONVENTIONS.md. RLS mirrors M2b: service-role-all +
--    role-band reads for authenticated + operator/admin writes.
--
-- Write-safety hotspots addressed:
--   - content_type CHECK — runner assertion: writing a mode='post' row
--     with any other content_type value fails at the schema layer, not
--     in a hypothetical app-layer invariant.
--   - wp_post_id partial UNIQUE — two publishes racing the same WP post
--     id under the same site blow up with 23505; the lib layer maps it
--     to UNIQUE_VIOLATION instead of the raw Postgres error.
--   - slug partial UNIQUE — no two live posts share a slug within a
--     site; M13-4's slug-rename edit surfaces UNIQUE_VIOLATION exactly
--     as pages does today.
--   - version_lock — optimistic concurrency on operator metadata edits
--     (title / slug / excerpt / status). Caller passes expected_version;
--     a stale expected_version returns zero rows and the lib layer
--     surfaces VERSION_CONFLICT. Constraint `version_lock >= 1`
--     matches M15's schema defense-in-depth.
--   - published_at coherence — CHECK forbids status='published' with
--     NULL published_at so a "published but never published at" row is
--     schema-impossible.

-- ----------------------------------------------------------------------------
-- posts
-- ----------------------------------------------------------------------------

CREATE TABLE posts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id                uuid NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,

  -- Runner assertion key. A post row is always content_type='post';
  -- CHECK gives schema-level proof the runner dispatched correctly.
  content_type           text NOT NULL DEFAULT 'post'
    CHECK (content_type = 'post'),

  -- WP link. NULL until first publish assigns the WP id; then frozen.
  wp_post_id             bigint,

  slug                   text NOT NULL,
  title                  text NOT NULL,

  -- Blog-specific fields. excerpt is WP's post excerpt (feeds + SEO);
  -- published_at records when this specific post was published to WP
  -- (coherence-constrained below against status).
  excerpt                text,
  published_at           timestamptz,

  -- The WP author — opollo_users row that authored the post.
  -- SET NULL on user delete so historical provenance survives user
  -- deprovisioning (matches `created_by` semantics in DATA_CONVENTIONS).
  author_id              uuid
    REFERENCES opollo_users(id) ON DELETE SET NULL,

  template_id            uuid
    REFERENCES design_templates(id) ON DELETE SET NULL,

  -- Snapshot of the design system version the runner used. Not a FK
  -- so a design system can be archived while the post keeps a
  -- legible record of what it was generated against (same rationale
  -- as `pages.design_system_version`).
  design_system_version  integer NOT NULL
    CHECK (design_system_version >= 1),

  -- Generative columns — operator-facing brief and the structured
  -- content + final HTML produced by the runner. `content_structured`
  -- is the intermediate jsonb the runner writes on every pass;
  -- `generated_html` is the promoted final output.
  content_brief          jsonb,
  content_structured     jsonb,
  generated_html         text,

  status                 text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'scheduled')),

  last_edited_by         uuid
    REFERENCES opollo_users(id) ON DELETE SET NULL,

  version_lock           integer NOT NULL DEFAULT 1
    CHECK (version_lock >= 1),

  -- Audit columns per DATA_CONVENTIONS.md.
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  created_by             uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  updated_by             uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  deleted_by             uuid REFERENCES opollo_users(id) ON DELETE SET NULL,

  -- Published rows must have a published_at timestamp.
  CONSTRAINT posts_published_at_coherent
    CHECK (status <> 'published' OR published_at IS NOT NULL)
);

-- Partial UNIQUE on (site_id, wp_post_id) WHERE wp_post_id IS NOT NULL
-- — NULL is distinct, so many drafts coexist before WP assigns an id;
-- published posts have exactly one (site_id, wp_post_id) pair.
CREATE UNIQUE INDEX posts_site_wp_post_unique
  ON posts (site_id, wp_post_id)
  WHERE wp_post_id IS NOT NULL;

-- Partial UNIQUE on (site_id, slug) WHERE deleted_at IS NULL — two
-- live posts on the same site cannot share a slug. Soft-deleted rows
-- don't contend, so archiving-and-restoring-later is safe.
CREATE UNIQUE INDEX posts_site_slug_live_unique
  ON posts (site_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_posts_site_status
  ON posts (site_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_posts_site_updated
  ON posts (site_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_posts_author
  ON posts (author_id)
  WHERE author_id IS NOT NULL AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- Row Level Security — posts.
-- Shape: service-role-all + authenticated read for all role bands +
-- authenticated write for admin/operator. Viewers read-only. Matches
-- the M12-1 RLS template which is itself a direct descendant of M2b.
-- ----------------------------------------------------------------------------

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON posts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY posts_read ON posts
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY posts_insert ON posts
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));

CREATE POLICY posts_update ON posts
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));

CREATE POLICY posts_delete ON posts
  FOR DELETE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'));
