-- Migration 0095 — fix update_brand_profile COALESCE for TEXT[] columns.
--
-- Bug: ARRAY(SELECT jsonb_array_elements_text(p_fields->'key')) returns
-- '{}'::text[] (empty array, not NULL) when the key is absent from p_fields.
-- COALESCE then picks the empty array over cur.<field>, erasing the existing
-- value on every versioning pass that doesn't include that field.
--
-- Fix: gate each array expression with (p_fields ? 'key') so absent keys
-- fall through to NULL → COALESCE falls back to cur.<field>.

CREATE OR REPLACE FUNCTION update_brand_profile(
  p_company_id     UUID,
  p_updated_by     UUID,
  p_change_summary TEXT,
  p_fields         JSONB
) RETURNS platform_brand_profiles AS $$
DECLARE
  cur platform_brand_profiles;
  nxt platform_brand_profiles;
BEGIN
  SELECT * INTO cur
    FROM platform_brand_profiles
   WHERE company_id = p_company_id AND is_active = true
   LIMIT 1;

  IF cur IS NULL THEN
    RAISE EXCEPTION 'No active brand profile for company %', p_company_id;
  END IF;

  UPDATE platform_brand_profiles
     SET is_active   = false,
         updated_at  = now(),
         updated_by  = p_updated_by
   WHERE id = cur.id;

  INSERT INTO platform_brand_profiles (
    company_id, version, is_active, change_summary, updated_by, created_by,
    primary_colour, secondary_colour, accent_colour,
    logo_primary_url, logo_dark_url, logo_light_url, logo_icon_url,
    heading_font, body_font, image_style, approved_style_ids, safe_mode,
    personality_traits, formality, point_of_view,
    preferred_vocabulary, avoided_terms, voice_examples,
    focus_topics, avoided_topics, industry,
    default_approval_required, default_approval_rule, platform_overrides,
    hashtag_strategy, max_post_length, content_restrictions
  ) VALUES (
    p_company_id, cur.version + 1, true, p_change_summary, p_updated_by, cur.created_by,
    COALESCE((p_fields->>'primary_colour'),    cur.primary_colour),
    COALESCE((p_fields->>'secondary_colour'),  cur.secondary_colour),
    COALESCE((p_fields->>'accent_colour'),     cur.accent_colour),
    COALESCE((p_fields->>'logo_primary_url'),  cur.logo_primary_url),
    COALESCE((p_fields->>'logo_dark_url'),     cur.logo_dark_url),
    COALESCE((p_fields->>'logo_light_url'),    cur.logo_light_url),
    COALESCE((p_fields->>'logo_icon_url'),     cur.logo_icon_url),
    COALESCE((p_fields->>'heading_font'),      cur.heading_font),
    COALESCE((p_fields->>'body_font'),         cur.body_font),
    COALESCE((p_fields->'image_style'),        cur.image_style),
    COALESCE(
      CASE WHEN p_fields ? 'approved_style_ids'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_fields->'approved_style_ids'))
        ELSE NULL END,
      cur.approved_style_ids
    ),
    COALESCE((p_fields->>'safe_mode')::boolean, cur.safe_mode),
    COALESCE(
      CASE WHEN p_fields ? 'personality_traits'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_fields->'personality_traits'))
        ELSE NULL END,
      cur.personality_traits
    ),
    COALESCE((p_fields->>'formality')::brand_formality,    cur.formality),
    COALESCE((p_fields->>'point_of_view')::brand_pov,      cur.point_of_view),
    COALESCE(
      CASE WHEN p_fields ? 'preferred_vocabulary'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_fields->'preferred_vocabulary'))
        ELSE NULL END,
      cur.preferred_vocabulary
    ),
    COALESCE(
      CASE WHEN p_fields ? 'avoided_terms'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_fields->'avoided_terms'))
        ELSE NULL END,
      cur.avoided_terms
    ),
    COALESCE(
      CASE WHEN p_fields ? 'voice_examples'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_fields->'voice_examples'))
        ELSE NULL END,
      cur.voice_examples
    ),
    COALESCE(
      CASE WHEN p_fields ? 'focus_topics'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_fields->'focus_topics'))
        ELSE NULL END,
      cur.focus_topics
    ),
    COALESCE(
      CASE WHEN p_fields ? 'avoided_topics'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_fields->'avoided_topics'))
        ELSE NULL END,
      cur.avoided_topics
    ),
    COALESCE((p_fields->>'industry'), cur.industry),
    COALESCE((p_fields->>'default_approval_required')::boolean, cur.default_approval_required),
    COALESCE((p_fields->>'default_approval_rule')::social_approval_rule, cur.default_approval_rule),
    COALESCE((p_fields->'platform_overrides'), cur.platform_overrides),
    COALESCE((p_fields->>'hashtag_strategy')::brand_hashtag,   cur.hashtag_strategy),
    COALESCE((p_fields->>'max_post_length')::brand_post_length, cur.max_post_length),
    COALESCE(
      CASE WHEN p_fields ? 'content_restrictions'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_fields->'content_restrictions'))
        ELSE NULL END,
      cur.content_restrictions
    )
  ) RETURNING * INTO nxt;

  RETURN nxt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
