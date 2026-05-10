-- Fix source classification for iStock images that were bulk-uploaded via the
-- admin UI before the upload route learned to detect iStock filenames.
-- Before: all uploads got source='upload', source_ref=filename.
-- After:  istock[-_]<6+digits> filenames get source='istock', source_ref=<digits>.
--
-- Uses the same pattern as lib/image-dimensions.ts ISTOCK_FILENAME_RE:
-- iStock[-_](\d{6,})  (case-insensitive, anywhere in the filename)
-- so both the SQL migration and the TypeScript upload path agree on what
-- constitutes an iStock filename.
--
-- When multiple 'upload' rows share the same extracted istock ID (e.g.
-- istock-1234567.jpg and istock-1234567-v2.jpg), updating all of them would
-- violate UNIQUE (source, source_ref). DISTINCT ON picks exactly one winner
-- per istock_id (lowest UUID wins for determinism). Any 'upload' rows that
-- already have a corresponding 'istock' row are skipped by the NOT EXISTS
-- guard. Losers keep source='upload'.

WITH candidates AS (
  SELECT
    id,
    (regexp_match(filename, 'istock[-_](\d{6,})', 'i'))[1] AS istock_id
  FROM image_library
  WHERE source   = 'upload'
    AND filename ~* 'istock[-_]\d{6,}'
),
winners AS (
  SELECT DISTINCT ON (istock_id) id, istock_id
  FROM candidates
  WHERE NOT EXISTS (
    SELECT 1
    FROM image_library ex
    WHERE ex.source     = 'istock'
      AND ex.source_ref = candidates.istock_id
  )
  ORDER BY istock_id, id
)
UPDATE image_library
SET
  source     = 'istock',
  source_ref = winners.istock_id,
  updated_at = now()
FROM winners
WHERE image_library.id = winners.id;
