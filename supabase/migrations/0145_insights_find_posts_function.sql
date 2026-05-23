-- Find published posts that need feature extraction.
-- Queries social_post_analytics_snapshots (which has bundle_post_id and content)
-- rather than social_post_master (which has no bundle_post_id column).

CREATE OR REPLACE FUNCTION find_posts_needing_feature_extract(
  platforms TEXT[],
  limit_count INTEGER DEFAULT 100
)
RETURNS TABLE (
  bundle_post_id TEXT,
  company_id     UUID,
  profile_id     UUID,
  platform       TEXT,
  content        TEXT,
  media_urls     TEXT[],
  posted_at      TIMESTAMPTZ,
  timezone       TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    spas.bundle_post_id,
    psp.company_id,
    psp.id          AS profile_id,
    spas.platform::text,
    spas.content,
    spas.media_urls,
    spas.posted_at,
    pc.timezone
  FROM social_post_analytics_snapshots spas
  INNER JOIN platform_social_profiles psp
    ON psp.id = spas.profile_id
  INNER JOIN platform_companies pc
    ON pc.id = psp.company_id
  WHERE spas.platform::text = ANY(platforms)
    AND spas.content IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ins_post_features ipf
      WHERE ipf.bundle_post_id = spas.bundle_post_id
    )
  GROUP BY spas.bundle_post_id, psp.company_id, psp.id, spas.platform, spas.content,
           spas.media_urls, spas.posted_at, pc.timezone
  ORDER BY MAX(spas.posted_at) DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;
