-- Rollback for 0158: remove generated-images bucket and its RLS policy.
-- Only safe to run when the bucket is empty — check storage.objects first.
DROP POLICY IF EXISTS generated_images_company_read ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'generated-images';
