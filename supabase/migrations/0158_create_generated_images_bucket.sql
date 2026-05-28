-- 0158: storage bucket for AI-generated images (Ideogram v3 + Bannerbear composites).
--
-- Separate from "social-media" (composer direct-upload, 0113) so MIME
-- allow-lists and size limits don't collide. All writes come from
-- server-side code using the service role; authenticated users only need
-- read access to their own company's prefix.
--
-- Path convention: {company_id}/generated/{ts}-{rand}.{ext}  (Ideogram backgrounds)
--                  {company_id}/composite/{ts}-{rand}.{ext}  (Bannerbear composites)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'generated-images',
  'generated-images',
  false,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Company members (editor+) may read images under their own company prefix.
-- Writes are service-role only — no WITH CHECK needed for authenticated users.
DROP POLICY IF EXISTS generated_images_company_read ON storage.objects;
CREATE POLICY generated_images_company_read
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'generated-images'
    AND EXISTS (
      SELECT 1
      FROM platform_company_users pcu
      WHERE pcu.user_id = auth.uid()
        AND pcu.company_id = (storage.foldername(name))[1]::uuid
        AND pcu.role IN ('editor', 'approver', 'admin')
    )
  );
