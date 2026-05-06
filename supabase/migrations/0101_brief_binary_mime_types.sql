-- ---------------------------------------------------------------------------
-- M12-PDF: Extend briefs.source_mime_type CHECK + storage bucket
-- allowed_mime_types to accept PDF and Word documents.
--
-- The feature is gated behind OPOLLO_BRIEF_BINARY_PARSERS=1 at the
-- application layer; the DB simply stops rejecting the new values so
-- the feature can be toggled on without a follow-up migration.
-- ---------------------------------------------------------------------------

ALTER TABLE briefs
  DROP CONSTRAINT IF EXISTS briefs_source_mime_type_check;

ALTER TABLE briefs
  ADD CONSTRAINT briefs_source_mime_type_check CHECK (
    source_mime_type IN (
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  );

-- Extend the storage bucket allowlist so Supabase Storage accepts uploads
-- of the new types directly from the browser / server.
UPDATE storage.buckets
SET    allowed_mime_types = ARRAY[
         'text/plain',
         'text/markdown',
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       ]
WHERE  id = 'site-briefs';
