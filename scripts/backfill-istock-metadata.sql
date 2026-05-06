-- backfill-istock-metadata.sql
--
-- Backfills title, alt_text, caption, and tags for iStock image_library rows
-- that have no title set. Derives values purely from the stored filename — no
-- Cloudflare or external API calls required.
--
-- Run this in the Supabase SQL editor (or via psql) against the target db.
-- Safe to re-run: only touches rows where title IS NULL.
--
-- After this script, run scripts/backfill-image-captions.ts for EXIF/IPTC
-- extraction (requires CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_IMAGES_API_TOKEN)
-- to upgrade placeholder values to real keyword/caption data.

UPDATE image_library
SET
  title = CASE
    WHEN filename ~* '^istock[-_](\d{6,})'
      THEN 'iStock Image ' || (regexp_match(lower(filename), '^istock[-_](\d{6,})'))[1]
    ELSE
      -- Generic: strip extension, replace dashes/underscores with spaces
      trim(regexp_replace(regexp_replace(filename, '\.[^.]+$', ''), '[-_]+', ' ', 'g'))
  END,
  alt_text = COALESCE(alt_text, CASE
    WHEN filename ~* '^istock[-_](\d{6,})'
      THEN 'iStock Image ' || (regexp_match(lower(filename), '^istock[-_](\d{6,})'))[1]
    ELSE
      trim(regexp_replace(regexp_replace(filename, '\.[^.]+$', ''), '[-_]+', ' ', 'g'))
  END),
  caption = COALESCE(NULLIF(caption, ''), CASE
    WHEN filename ~* '^istock'
      THEN 'iStock stock photography'
    ELSE NULL
  END),
  tags = CASE
    WHEN (tags IS NULL OR array_length(tags, 1) IS NULL) AND filename ~* '^istock'
      THEN ARRAY['istock', 'stock photography']
    ELSE COALESCE(tags, ARRAY[]::text[])
  END,
  updated_at = NOW()
WHERE
  title IS NULL
  AND deleted_at IS NULL
  AND filename IS NOT NULL;

-- Report how many rows were updated.
SELECT
  COUNT(*) FILTER (WHERE title IS NOT NULL) AS has_title,
  COUNT(*) FILTER (WHERE title IS NULL)     AS missing_title,
  COUNT(*) FILTER (WHERE caption IS NOT NULL) AS has_caption,
  COUNT(*) FILTER (WHERE alt_text IS NOT NULL) AS has_alt_text
FROM image_library
WHERE deleted_at IS NULL;
