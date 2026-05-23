-- PR-07: SQL helper for recommendation generators
-- Joins ins_post_features with social_post_analytics_snapshots

CREATE OR REPLACE FUNCTION get_posts_with_engagement(
  p_company_id UUID,
  p_platform TEXT,
  p_cutoff TIMESTAMPTZ,
  p_min_impressions INTEGER DEFAULT 50
)
RETURNS TABLE (
  bundle_post_id TEXT,
  posted_at TIMESTAMPTZ,
  engagement_rate NUMERIC,
  impressions BIGINT,
  word_count INTEGER,
  has_question BOOLEAN,
  hashtag_count INTEGER,
  media_type TEXT,
  day_of_week INTEGER,
  hour_of_day_client_tz INTEGER,
  topic_tags TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ipf.bundle_post_id,
    ipf.posted_at,
    spas.engagement_rate,
    spas.impressions::bigint,
    ipf.word_count,
    ipf.has_question,
    ipf.hashtag_count,
    ipf.media_type::text,
    ipf.day_of_week,
    ipf.hour_of_day_client_tz,
    ipf.topic_tags
  FROM ins_post_features ipf
  INNER JOIN social_post_analytics_snapshots spas
    ON spas.bundle_post_id = ipf.bundle_post_id
   AND spas.platform::text = p_platform
  WHERE ipf.company_id = p_company_id
    AND ipf.platform::text = p_platform
    AND ipf.posted_at >= p_cutoff
    AND ipf.deleted_at IS NULL
    AND spas.impressions >= p_min_impressions
    AND spas.engagement_rate IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;
