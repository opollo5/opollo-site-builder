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
-- The NOT EXISTS guard prevents the UPDATE from running when an 'istock' row
-- already exists with the same numeric ID (e.g. if the iStock CSV seed was
-- also used for these images), which would otherwise violate the
-- UNIQUE (source, source_ref) constraint.

UPDATE image_library
SET
  source     = 'istock',
  source_ref = (regexp_match(filename, 'istock[-_](\d{6,})', 'i'))[1],
  updated_at = now()
WHERE source   = 'upload'
  AND filename ~* 'istock[-_]\d{6,}'
  AND NOT EXISTS (
    SELECT 1
    FROM image_library AS dup
    WHERE dup.source     = 'istock'
      AND dup.source_ref = (regexp_match(image_library.filename, 'istock[-_](\d{6,})', 'i'))[1]
      AND dup.id         != image_library.id
  );
